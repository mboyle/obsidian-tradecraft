import { MarkdownView, Notice, Platform, Plugin, TFile, type TAbstractFile } from "obsidian";
import { BacklinkService } from "./backlinks/BacklinkService";
import { BacklinksRenderer, type RendererHost } from "./render/BacklinksRenderer";
import { createLivePreviewExtension } from "./render/LivePreviewExtension";
import { ReadingModeRenderer } from "./render/ReadingModeRenderer";
import { ReferenceNavigator } from "./render/ReferenceNavigator";
import { DailyNoteDisplayController } from "./dailyDates/DailyNoteDisplayController";
import {
  DailyNoteDisplayService,
  type DailyNoteDatePreview,
} from "./dailyDates/DailyNoteDisplayService";
import { WeeklyDailyNoteNavigator } from "./dailyDates/WeeklyDailyNoteNavigator";
import { todayAtStartOfDay } from "./dailyDates/DailyNoteFileResolver";
import {
  DAILY_TIMELINE_VIEW_TYPE,
  DailyTimelineView,
} from "./dailyDates/DailyTimelineView";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings/Settings";
import { DossierSettingTab, type SettingsHost } from "./settings/SettingsTab";
import type { DossierSettings } from "./types";

export default class DossierPlugin extends Plugin implements RendererHost, SettingsHost {
  settings: DossierSettings = structuredClone(DEFAULT_SETTINGS);
  service!: BacklinkService;
  navigator!: ReferenceNavigator;
  dailyNoteDisplay!: DailyNoteDisplayService;
  private dailyNoteDisplayController!: DailyNoteDisplayController;
  private weeklyDailyNoteNavigator!: WeeklyDailyNoteNavigator;
  private readingRenderer!: ReadingModeRenderer;
  private readonly renderers = new Set<BacklinksRenderer>();
  private readonly sourceTimers = new Map<string, number>();
  private fullIndexTimer?: number;
  private awaitingGlobalResolution = false;
  private initialized = false;

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.dailyNoteDisplay = new DailyNoteDisplayService(() => this.settings.dailyNoteDates);
    this.service = new BacklinkService(this.app, () => this.settings, this.dailyNoteDisplay);
    this.navigator = new ReferenceNavigator(this.app);
    this.readingRenderer = new ReadingModeRenderer(this);
    this.dailyNoteDisplayController = this.addChild(new DailyNoteDisplayController(
      this.app,
      this.dailyNoteDisplay,
      () => this.settings,
    ));
    this.weeklyDailyNoteNavigator = this.addChild(new WeeklyDailyNoteNavigator(
      this.app,
      this.dailyNoteDisplay,
      () => this.settings,
    ));
    this.registerView(DAILY_TIMELINE_VIEW_TYPE, (leaf) => new DailyTimelineView(
      leaf,
      this.dailyNoteDisplay,
      () => this.settings,
    ));

    this.addSettingTab(new DossierSettingTab(this.app, this));
    this.registerHoverLinkSource("dossier", { display: "Dossier", defaultMod: false });
    this.registerMarkdownPostProcessor(this.readingRenderer.postProcessor, 100);
    this.registerEditorExtension(createLivePreviewExtension(this));
    this.registerCommands();

    this.app.workspace.onLayoutReady(() => {
      if (this.initialized) return;
      this.initialized = true;
      this.service.buildIndex();
      this.registerReactiveEvents();
      this.dailyNoteDisplayController.refreshAll();
      this.weeklyDailyNoteNavigator.refreshAll();
      this.readingRenderer.reconcileEmptyViews(this.app.workspace);
      this.service.notifyAll();
      if (
        Platform.isDesktopApp
        && this.settings.dailyNoteDates.timeline.enabled
        && this.settings.dailyNoteDates.timeline.openOnStartup
      ) {
        void this.openDailyTimelineOnStartup();
      }
    });

    this.register(() => {
      for (const timer of this.sourceTimers.values()) window.clearTimeout(timer);
      if (this.fullIndexTimer !== undefined) window.clearTimeout(this.fullIndexTimer);
      this.sourceTimers.clear();
    });
  }

  onunload(): void {
    this.readingRenderer.destroy();
  }

  getSettings(): DossierSettings {
    return this.settings;
  }

  async persistSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async saveSettingsAndRefresh(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.persistSettings();
    this.dailyNoteDisplay.invalidate();
    this.dailyNoteDisplayController.refreshAll();
    this.weeklyDailyNoteNavigator.refreshAll();
    this.service.clearCache();
    this.readingRenderer.reconcileEmptyViews(this.app.workspace);
  }

  getDailyNoteDatePreview(): DailyNoteDatePreview {
    return this.dailyNoteDisplay.getPreview();
  }

  registerRenderer(renderer: BacklinksRenderer): void {
    this.renderers.add(renderer);
  }

  unregisterRenderer(renderer: BacklinksRenderer): void {
    this.renderers.delete(renderer);
  }

  private registerReactiveEvents(): void {
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      this.service.invalidateSource(file.path);
      this.scheduleSourceReconcile(file.path, 300);
    }));
    this.registerEvent(this.app.metadataCache.on("resolve", (file) => {
      this.scheduleSourceReconcile(file.path, 80);
    }));
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      if (!this.awaitingGlobalResolution) return;
      this.awaitingGlobalResolution = false;
      this.scheduleFullIndexRebuild(50);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        this.service.invalidateSource(file.path);
        this.scheduleSourceReconcile(file.path, 300);
      }
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        this.scheduleSourceReconcile(file.path, 80);
        this.awaitingGlobalResolution = true;
        this.scheduleFullIndexRebuild(1000);
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => this.handleDelete(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && file.extension === "md") void this.handleRename(file, oldPath);
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.readingRenderer.reconcileEmptyViews(this.app.workspace);
    }));
    this.registerEvent(this.app.workspace.on("file-open", () => {
      window.setTimeout(() => this.readingRenderer.reconcileEmptyViews(this.app.workspace), 0);
    }));
  }

  private scheduleSourceReconcile(sourcePath: string, delay: number): void {
    const existing = this.sourceTimers.get(sourcePath);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.sourceTimers.delete(sourcePath);
      const before = new Set(this.service.index.getTargetsForSource(sourcePath));
      const affected = this.service.index.updateSource(sourcePath);
      for (const targetPath of new Set([...before, ...affected])) {
        this.service.invalidateTarget(targetPath);
      }
    }, delay);
    this.sourceTimers.set(sourcePath, timer);
  }

  private handleDelete(file: TAbstractFile): void {
    const affectedTargets = this.service.index.removeSource(file.path);
    this.service.index.removeTarget(file.path);
    this.service.invalidateSource(file.path);
    this.service.invalidateTarget(file.path);
    for (const targetPath of affectedTargets) this.service.invalidateTarget(targetPath);
    let settingsChanged = false;
    if (Object.prototype.hasOwnProperty.call(this.settings.noteOverrides, file.path)) {
      delete this.settings.noteOverrides[file.path];
      settingsChanged = true;
    }
    if (this.settings.collapsedTargets.includes(file.path)) {
      this.settings.collapsedTargets = this.settings.collapsedTargets.filter((path) => path !== file.path);
      settingsChanged = true;
    }
    if (settingsChanged) void this.persistSettings();
  }

  private scheduleFullIndexRebuild(delay: number): void {
    if (this.fullIndexTimer !== undefined) window.clearTimeout(this.fullIndexTimer);
    this.fullIndexTimer = window.setTimeout(() => {
      this.fullIndexTimer = undefined;
      this.awaitingGlobalResolution = false;
      this.service.buildIndex();
      this.service.clearCache();
    }, delay);
  }

  private async handleRename(file: TFile, oldPath: string): Promise<void> {
    this.dailyNoteDisplay.invalidate(oldPath);
    this.dailyNoteDisplay.invalidate(file.path);
    const affected = this.service.index.renameFile(oldPath, file.path);
    this.service.invalidateSource(oldPath);
    this.service.invalidateSource(file.path);
    this.service.invalidateTarget(oldPath);
    this.service.invalidateTarget(file.path);
    for (const targetPath of affected) this.service.invalidateTarget(targetPath);

    if (Object.prototype.hasOwnProperty.call(this.settings.noteOverrides, oldPath)) {
      this.settings.noteOverrides[file.path] = this.settings.noteOverrides[oldPath]!;
      delete this.settings.noteOverrides[oldPath];
    }
    if (this.settings.collapsedTargets.includes(oldPath)) {
      this.settings.collapsedTargets = this.settings.collapsedTargets
        .map((path) => path === oldPath ? file.path : path)
        .filter((path, index, all) => all.indexOf(path) === index);
    }
    await this.persistSettings();
    this.scheduleSourceReconcile(file.path, 80);
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-daily-timeline",
      name: "Open Daily Timeline",
      checkCallback: (checking) => {
        if (!this.settings.dailyNoteDates.timeline.enabled || !Platform.isDesktopApp) return false;
        if (!checking) void this.openDailyTimeline();
        return true;
      },
    });
    this.addCommand({
      id: "toggle-current-note",
      name: "Toggle backlinks for current note",
      checkCallback: (checking) => {
        const file = this.activeMarkdownFile();
        if (!file) return false;
        if (!checking) void this.toggleCurrentNote(file);
        return true;
      },
    });
    this.addCommand({
      id: "expand-all-current-note",
      name: "Expand all references",
      checkCallback: (checking) => this.withActiveRenderers(checking, (renderer) => renderer.expandAll()),
    });
    this.addCommand({
      id: "collapse-current-note",
      name: "Collapse references",
      checkCallback: (checking) => this.withActiveRenderers(checking, (renderer) => renderer.collapse()),
    });
    this.addCommand({
      id: "refresh-current-note",
      name: "Refresh references",
      checkCallback: (checking) => {
        const file = this.activeMarkdownFile();
        if (!file) return false;
        if (!checking) this.service.invalidateTarget(file.path);
        return true;
      },
    });
  }

  private async openDailyTimeline(): Promise<void> {
    const activeFile = this.activeMarkdownFile();
    const activeDate = activeFile ? this.dailyNoteDisplay.getDailyNoteDate(activeFile) : null;
    const anchorDate = (activeDate ?? todayAtStartOfDay()).format("YYYY-MM-DD");
    const existing = this.app.workspace.getLeavesOfType(DAILY_TIMELINE_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: DAILY_TIMELINE_VIEW_TYPE,
      active: true,
      state: { anchorDate },
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async openDailyTimelineOnStartup(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DAILY_TIMELINE_VIEW_TYPE)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    await this.openDailyTimeline();
  }

  private async toggleCurrentNote(file: TFile): Promise<void> {
    const frontmatterValue = this.app.metadataCache.getFileCache(file)?.frontmatter?.["contextual-backlinks"];
    if (typeof frontmatterValue === "boolean") {
      new Notice("Dossier: this note is controlled by its contextual-backlinks property.");
      return;
    }
    this.settings.noteOverrides[file.path] = !this.service.shouldRender(file);
    await this.persistSettings();
    this.service.invalidateTarget(file.path);
  }

  private activeMarkdownFile(): TFile | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
  }

  private withActiveRenderers(checking: boolean, action: (renderer: BacklinksRenderer) => void): boolean {
    const file = this.activeMarkdownFile();
    if (!file) return false;
    if (!checking) {
      for (const renderer of this.renderers) {
        if (renderer.targetFile.path === file.path) action(renderer);
      }
    }
    return true;
  }
}
