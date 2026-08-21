import { Component, MarkdownView, TFile, type App, type WorkspaceLeaf } from "obsidian";
import type { DossierSettings } from "../types";
import type { DailyNoteDisplayService } from "./DailyNoteDisplayService";

const LABEL_MARKER = "data-dossier-daily-date";
const NATIVE_LABEL = "data-dossier-native-label";
const FILE_ROW_SELECTOR = ".nav-file-title[data-path]";
const FILE_LABEL_SELECTOR = ".nav-file-title-content";

interface MarkdownBinding {
  view: MarkdownView;
  observer: MutationObserver;
  pointerDown: (event: PointerEvent) => void;
  focusIn: (event: FocusEvent) => void;
  focusOut: (event: FocusEvent) => void;
}

interface TabState {
  titleEl: HTMLElement;
  nativeText: string;
  nativeAria: string | null;
  nativeTitle: string | null;
  path: string;
}

type TabLeafCompatibility = WorkspaceLeaf & { tabHeaderEl?: HTMLElement };

export class DailyNoteDisplayController extends Component {
  private readonly explorerObservers = new Map<HTMLElement, MutationObserver>();
  private readonly markdownBindings = new Map<HTMLElement, MarkdownBinding>();
  private readonly tabStates = new Map<HTMLElement, TabState>();
  private readonly blurTimers = new Set<number>();
  private readonly editingTitles = new WeakSet<HTMLElement>();
  private frame?: number;

  constructor(
    private readonly app: App,
    private readonly service: DailyNoteDisplayService,
    private readonly getSettings: () => DossierSettings,
  ) {
    super();
  }

  onload(): void {
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.service.invalidate(oldPath);
      this.service.invalidate(file.path);
      this.scheduleRefresh();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.service.invalidate(file.path);
      this.scheduleRefresh();
    }));
    this.scheduleRefresh();
  }

  onunload(): void {
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    for (const timer of this.blurTimers) window.clearTimeout(timer);
    this.blurTimers.clear();
    for (const [container, observer] of this.explorerObservers) {
      observer.disconnect();
      this.restoreMarkedLabels(container);
    }
    this.explorerObservers.clear();
    for (const [container, binding] of this.markdownBindings) {
      binding.observer.disconnect();
      container.removeEventListener("pointerdown", binding.pointerDown, true);
      container.removeEventListener("focusin", binding.focusIn);
      container.removeEventListener("focusout", binding.focusOut);
      this.restoreMarkedLabels(container);
    }
    this.markdownBindings.clear();
    for (const header of [...this.tabStates.keys()]) this.restoreTab(header);
  }

  refreshAll(): void {
    this.service.invalidate();
    this.syncExplorerObservers();
    this.syncMarkdownBindings();
    this.applyExplorerLabels();
    this.applyInlineTitles();
    this.applyTabTitles();
  }

  private scheduleRefresh(): void {
    if (this.frame !== undefined) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = undefined;
      this.syncExplorerObservers();
      this.syncMarkdownBindings();
      this.applyExplorerLabels();
      this.applyInlineTitles();
      this.applyTabTitles();
    });
  }

  private syncExplorerObservers(): void {
    const enabled = this.isSurfaceEnabled("fileExplorer");
    const current = new Set<HTMLElement>();
    if (enabled) {
      for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
        const container = leaf.view.containerEl;
        if (!container.querySelector(".nav-files-container")) continue;
        current.add(container);
        if (this.explorerObservers.has(container)) continue;
        const observer = new MutationObserver(() => this.scheduleRefresh());
        observer.observe(container, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["data-path", "class", "contenteditable"],
        });
        this.explorerObservers.set(container, observer);
      }
    }
    for (const [container, observer] of this.explorerObservers) {
      if (current.has(container)) continue;
      observer.disconnect();
      this.restoreMarkedLabels(container);
      this.explorerObservers.delete(container);
    }
  }

  private syncMarkdownBindings(): void {
    const enabled = this.isSurfaceEnabled("inlineTitle");
    const current = new Map<HTMLElement, MarkdownView>();
    if (enabled) {
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        if (!(leaf.view instanceof MarkdownView)) continue;
        current.set(leaf.view.containerEl, leaf.view);
      }
    }

    for (const [container, view] of current) {
      const existing = this.markdownBindings.get(container);
      if (existing) {
        existing.view = view;
        continue;
      }
      const pointerDown = (event: PointerEvent) => this.restoreInlineTitleForEditing(view, event.target);
      const focusIn = (event: FocusEvent) => this.restoreInlineTitleForEditing(view, event.target);
      const focusOut = (event: FocusEvent) => this.handleInlineTitleFocusOut(event);
      const observer = new MutationObserver(() => this.scheduleRefresh());
      observer.observe(container, { subtree: true, childList: true, characterData: true });
      container.addEventListener("pointerdown", pointerDown, true);
      container.addEventListener("focusin", focusIn);
      container.addEventListener("focusout", focusOut);
      this.markdownBindings.set(container, { view, observer, pointerDown, focusIn, focusOut });
    }

    for (const [container, binding] of this.markdownBindings) {
      if (current.has(container)) continue;
      binding.observer.disconnect();
      container.removeEventListener("pointerdown", binding.pointerDown, true);
      container.removeEventListener("focusin", binding.focusIn);
      container.removeEventListener("focusout", binding.focusOut);
      this.restoreMarkedLabels(container);
      this.markdownBindings.delete(container);
    }
  }

  private applyExplorerLabels(): void {
    if (!this.isSurfaceEnabled("fileExplorer")) return;
    for (const container of this.explorerObservers.keys()) {
      for (const row of Array.from(container.querySelectorAll<HTMLElement>(FILE_ROW_SELECTOR))) {
        const path = row.dataset.path;
        const label = row.querySelector<HTMLElement>(FILE_LABEL_SELECTOR);
        if (!path || !label) continue;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          this.restoreLabel(label);
          continue;
        }
        if (row.classList.contains("is-being-renamed") || label.isContentEditable) {
          this.restoreLabel(label, file.basename);
          continue;
        }
        this.applyLabel(label, this.service.getDisplayName(file), file.basename, file.path);
      }
    }
  }

  private applyInlineTitles(): void {
    if (!this.isSurfaceEnabled("inlineTitle")) return;
    for (const [container, binding] of this.markdownBindings) {
      const title = container.querySelector<HTMLElement>(".inline-title");
      const file = binding.view.file;
      if (!title || !file) continue;
      if (
        this.editingTitles.has(title)
        || title === document.activeElement
        || title.contains(document.activeElement)
      ) continue;
      this.applyLabel(title, this.service.getInlineTitle(file), file.basename, file.path);
    }
  }

  private applyTabTitles(): void {
    const enabled = this.isSurfaceEnabled("tabTitle");
    const currentHeaders = new Set<HTMLElement>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      const compatLeaf = leaf as TabLeafCompatibility;
      const header = compatLeaf.tabHeaderEl;
      const titleEl = header?.querySelector<HTMLElement>(".workspace-tab-header-inner-title");
      const file = leaf.view.file;
      if (!header || !titleEl || !file) continue;
      currentHeaders.add(header);
      const displayName = enabled ? this.service.getDisplayName(file) : null;
      if (!displayName) {
        this.restoreTab(header, leaf.getDisplayText());
        continue;
      }
      const existing = this.tabStates.get(header);
      if (existing && existing.path !== file.path) this.restoreTab(header);
      const state = this.tabStates.get(header) ?? {
        titleEl,
        nativeText: leaf.getDisplayText(),
        nativeAria: header.getAttribute("aria-label"),
        nativeTitle: titleEl.getAttribute("title"),
        path: file.path,
      };
      state.titleEl = titleEl;
      state.nativeText = leaf.getDisplayText();
      state.path = file.path;
      this.tabStates.set(header, state);
      if (titleEl.textContent !== displayName) titleEl.textContent = displayName;
      header.setAttribute("aria-label", displayName);
      titleEl.setAttribute("title", displayName);
    }
    for (const header of [...this.tabStates.keys()]) {
      if (!currentHeaders.has(header)) this.restoreTab(header);
    }
  }

  private restoreInlineTitleForEditing(view: MarkdownView, target: EventTarget | null): void {
    if (!(target instanceof HTMLElement) || !target.classList.contains("inline-title")) return;
    this.editingTitles.add(target);
    const file = view.file;
    if (file) this.restoreLabel(target, file.basename);
  }

  private handleInlineTitleFocusOut(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("inline-title")) return;
    const timer = window.setTimeout(() => {
      this.blurTimers.delete(timer);
      this.editingTitles.delete(target);
      this.scheduleRefresh();
    }, 200);
    this.blurTimers.add(timer);
  }

  private applyLabel(element: HTMLElement, displayName: string | null, nativeName: string, path: string): void {
    if (!displayName) {
      this.restoreLabel(element, nativeName);
      return;
    }
    element.setAttribute(LABEL_MARKER, path);
    element.setAttribute(NATIVE_LABEL, nativeName);
    if (element.textContent !== displayName) element.textContent = displayName;
  }

  private restoreLabel(element: HTMLElement, nativeName?: string): void {
    if (!element.hasAttribute(LABEL_MARKER)) return;
    const fallback = nativeName ?? element.getAttribute(NATIVE_LABEL) ?? "";
    if (element.textContent !== fallback) element.textContent = fallback;
    element.removeAttribute(LABEL_MARKER);
    element.removeAttribute(NATIVE_LABEL);
  }

  private restoreMarkedLabels(container: HTMLElement): void {
    for (const element of Array.from(container.querySelectorAll<HTMLElement>(`[${LABEL_MARKER}]`))) {
      this.restoreLabel(element);
    }
  }

  private restoreTab(header: HTMLElement, nativeText?: string): void {
    const state = this.tabStates.get(header);
    if (!state) return;
    state.titleEl.textContent = nativeText ?? state.nativeText;
    restoreAttribute(header, "aria-label", state.nativeAria);
    restoreAttribute(state.titleEl, "title", state.nativeTitle);
    this.tabStates.delete(header);
  }

  private isSurfaceEnabled(surface: keyof DossierSettings["dailyNoteDates"]["surfaces"]): boolean {
    const settings = this.getSettings().dailyNoteDates;
    return settings.enabled && settings.surfaces[surface];
  }
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}
