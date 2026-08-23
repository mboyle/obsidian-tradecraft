import { EditorState } from "@codemirror/state";
import { completionStatus } from "@codemirror/autocomplete";
import { searchPanelOpen } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import {
  ItemView,
  Keymap,
  Menu,
  Notice,
  Platform,
  TFile,
  setIcon,
  type WorkspaceLeaf,
  type ViewStateResult,
} from "obsidian";
import type { Moment } from "moment";
import type { DossierSettings } from "../types";
import type { DailyNoteDisplayService } from "./DailyNoteDisplayService";
import { DailyNoteFileResolver, todayAtStartOfDay } from "./DailyNoteFileResolver";
import {
  DEFERRED_DAILY_NOTE_STARTER,
  dailyContentForEditing,
  dailyContentForPersistence,
  hasMeaningfulDeferredDailyContent,
} from "./DeferredDailyNote";
import { dailyDateFromKey, dailyDateKey } from "./DailyWeek";
import { DailyTimelineWindow, timelineScrollDirection } from "./DailyTimelineWindow";
import { timelineLivePreviewExtensions } from "./TimelineLivePreview";
import { timelineWikiLinkExtensions } from "./TimelineLinkSuggest";
import { timelineEditingExtensions } from "./TimelineEditing";
import { timelinePasteDropExtensions } from "./TimelinePasteDrop";
import {
  findTimelineEditOffset,
  type TimelineEditIntent,
} from "./TimelineEditPosition";

export const DAILY_TIMELINE_VIEW_TYPE = "dossier-daily-timeline";

const SCROLL_THRESHOLD = 720;
const SAVE_DELAY_MS = 400;

interface TimelineDay {
  key: string;
  date: Moment;
  el: HTMLElement;
  title: HTMLButtonElement;
  body: HTMLElement;
  preview?: EditorView;
  renderGeneration: number;
  file: TFile | null;
}

interface TimelineEditor {
  day: TimelineDay;
  file: TFile | null;
  view: EditorView;
  baseContent: string;
  dirty: boolean;
  saveTimer?: number;
  saving?: Promise<boolean>;
  materializing?: Promise<boolean>;
  suppressUpdates: boolean;
}

interface DailyTimelineState {
  anchorDate?: unknown;
}

export class DailyTimelineView extends ItemView {
  navigation = true;
  icon = "calendar-range";
  private readonly resolver: DailyNoteFileResolver;
  private scroller?: HTMLElement;
  private feed?: HTMLElement;
  private dateWindow?: DailyTimelineWindow;
  private readonly days = new Map<string, TimelineDay>();
  private activeEditor?: TimelineEditor;
  private anchorKey = dailyDateKey(todayAtStartOfDay());
  private centerKey = this.anchorKey;
  private extending = false;
  private scrollFrame?: number;
  private initialized = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly service: DailyNoteDisplayService,
    private readonly getSettings: () => DossierSettings,
  ) {
    super(leaf);
    this.resolver = new DailyNoteFileResolver(this.app, service, () => getSettings().dailyNoteDates);
  }

  getViewType(): string {
    return DAILY_TIMELINE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Daily Timeline";
  }

  getState(): Record<string, unknown> {
    return { anchorDate: this.centerKey };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const key = readAnchorKey(state);
    if (!key) return;
    this.anchorKey = key;
    this.centerKey = key;
    if (this.initialized) await this.jumpToDate(dailyDateFromKey(key) ?? todayAtStartOfDay());
  }

  protected async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("dossier-daily-timeline");
    if (Platform.isMobileApp) {
      this.contentEl.createDiv({
        cls: "dossier-timeline-unavailable",
        text: "The Daily Timeline is available in Obsidian on desktop. Use the weekly navigator on mobile.",
      });
      return;
    }

    this.scroller = this.contentEl.createDiv({ cls: "dossier-timeline-scroller" });
    this.feed = this.scroller.createDiv({ cls: "dossier-timeline-feed" });
    this.registerDomEvent(this.scroller, "scroll", () => this.scheduleScrollWork(), { passive: true });
    removeTooltipAttributes(this.addAction(
      "calendar-clock",
      "Go to today",
      () => void this.jumpToDate(todayAtStartOfDay()),
    ));
    removeTooltipAttributes(this.addAction("file-plus-2", "Create or edit today's note", () => {
      void this.jumpToDate(todayAtStartOfDay(), true);
    }));

    this.registerEvent(this.app.vault.on("create", (file) => this.refreshPath(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile) this.handleExternalModify(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => this.handleDelete(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      void this.handleRename(oldPath, file.path);
    }));

    this.initialized = true;
    await this.jumpToDate(dailyDateFromKey(this.anchorKey) ?? todayAtStartOfDay());
  }

  protected async onClose(): Promise<void> {
    if (this.scrollFrame !== undefined) this.contentEl.win.cancelAnimationFrame(this.scrollFrame);
    await this.finishEditing();
    if (this.activeEditor) {
      if (this.activeEditor.saveTimer !== undefined) {
        this.activeEditor.day.el.win.clearTimeout(this.activeEditor.saveTimer);
      }
      this.activeEditor.view.destroy();
      this.activeEditor = undefined;
    }
    for (const key of [...this.days.keys()]) this.removeDay(key);
    this.contentEl.removeClass("dossier-daily-timeline");
    this.initialized = false;
  }

  async jumpToDate(date: Moment, edit = false): Promise<void> {
    if (!this.feed || !this.scroller) return;
    if (!(await this.finishEditing())) return;
    for (const key of [...this.days.keys()]) this.removeDay(key);
    this.feed.empty();
    this.dateWindow = new DailyTimelineWindow(
      date,
      this.getSettings().dailyNoteDates.timeline.windowDays,
    );
    this.anchorKey = dailyDateKey(date);
    this.centerKey = this.anchorKey;

    const fragment = this.feed.doc.createDocumentFragment();
    const renderTasks: Promise<void>[] = [];
    for (const key of this.dateWindow.keys) {
      const day = this.createDay(key);
      fragment.append(day.el);
      renderTasks.push(this.renderDay(day));
    }
    this.feed.append(fragment);
    await Promise.all(renderTasks);
    await nextAnimationFrame(this.scroller.win);
    const anchor = this.days.get(this.anchorKey);
    if (anchor) this.scroller.scrollTop = Math.max(0, anchor.el.offsetTop - this.feed.offsetTop);
    if (edit && anchor) await this.activateEditor(anchor);
  }

  private createDay(key: string): TimelineDay {
    const date = dailyDateFromKey(key) ?? todayAtStartOfDay();
    const el = this.feed!.doc.createElement("section");
    el.className = "dossier-timeline-day";
    el.dataset.date = key;
    const heading = el.createDiv({ cls: "dossier-timeline-heading" });
    const title = heading.createEl("button", {
      cls: "dossier-timeline-title",
      attr: { type: "button" },
    });
    const fullEditor = heading.createEl("button", {
      cls: "dossier-timeline-open-note",
      attr: { type: "button" },
    });
    setIcon(fullEditor, "file-pen-line");
    const body = el.createDiv({ cls: "dossier-timeline-body" });
    const day: TimelineDay = {
      key,
      date,
      el,
      title,
      body,
      renderGeneration: 0,
      file: null,
    };
    title.addEventListener("click", () => void this.activateEditor(day, "start"));
    fullEditor.addEventListener("click", (event) => void this.openAsNote(day, event));
    body.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("a, button, input, textarea, select, summary, .cm-editor")) return;
      const intent = captureEditIntent(day.body, event);
      void this.activateEditor(day, intent);
    });
    this.days.set(key, day);
    return day;
  }

  private async renderDay(day: TimelineDay): Promise<void> {
    if (this.activeEditor?.day === day) return;
    const generation = ++day.renderGeneration;
    this.destroyDayPreview(day);
    day.body.empty();
    day.el.removeClass("has-error");
    day.title.textContent = day.date.format(this.getSettings().dailyNoteDates.titleFormat);
    day.el.toggleClass("is-today", day.key === dailyDateKey(todayAtStartOfDay()));

    const path = this.service.dateToDailyFilePath(day.date);
    const file = this.app.vault.getFileByPath(path);
    day.file = file;
    day.el.toggleClass("is-missing", !file);
    day.el.querySelector<HTMLElement>(".dossier-timeline-open-note")?.toggleAttribute("hidden", !file);
    if (!file) {
      this.renderReadOnlySurface(
        day,
        DEFERRED_DAILY_NOTE_STARTER,
      );
      return;
    }

    try {
      const markdown = await this.app.vault.cachedRead(file);
      if (generation !== day.renderGeneration || !day.el.isConnected || this.activeEditor?.day === day) return;
      this.renderReadOnlySurface(
        day,
        dailyContentForEditing(markdown),
      );
    } catch (error) {
      if (generation !== day.renderGeneration) return;
      day.el.addClass("has-error");
      day.body.createDiv({ cls: "dossier-timeline-error", text: "Could not load this Daily Note." });
      console.error("Tradecraft: failed to render a Daily Note in the timeline", error);
    }
  }

  private renderReadOnlySurface(day: TimelineDay, content: string): void {
    this.destroyDayPreview(day);
    day.body.empty();
    const editorHost = day.body.createDiv({ cls: "dossier-timeline-editor is-readonly" });
    const view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: content,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          ...timelineLivePreviewExtensions({
            onLinkClick: ({ target, event }) => this.openTimelineLink(target, day.file?.path, event),
            onLinkHover: ({ target, event, targetEl }) => this.hoverTimelineLink(target, day.file?.path, event, targetEl),
            onLinkContext: ({ target, event }) => this.contextTimelineLink(target, day.file?.path, event),
            onTagClick: (tag) => void this.openTagSearch(tag),
            resolveEmbed: (target) => this.resolveTimelineEmbed(target, day.file?.path),
          }),
          EditorView.domEventHandlers({
            mousedown: (event, preview) => {
              if (event.button !== 0) return false;
              const target = event.target;
              if (target instanceof Element && target.closest("a, button, textarea, select, summary")) {
                return false;
              }
              const anchor = preview.posAtCoords({ x: event.clientX, y: event.clientY }, false);
              event.preventDefault();
              void this.activateEditor(day, anchor);
              return true;
            },
          }),
        ],
      }),
    });
    day.preview = view;
  }

  private async activateEditor(
    day: TimelineDay,
    requestedPosition: TimelineEditIntent | "start" | "end" | number = "end",
  ): Promise<void> {
    if (this.activeEditor?.day === day) {
      this.activeEditor.view.focus();
      return;
    }
    if (!(await this.finishEditing())) return;
    const behavior = this.getSettings().dailyNoteDates.navigator.missingNoteBehavior;
    const file = day.file;
    if ((!file && behavior === "nothing") || !day.el.isConnected) return;

    let content = DEFERRED_DAILY_NOTE_STARTER;
    let baseContent = "";
    if (file) {
      try {
        baseContent = await this.app.vault.cachedRead(file);
        content = dailyContentForEditing(baseContent);
      } catch (error) {
        console.error("Tradecraft: failed to read a Daily Note for editing", error);
        new Notice(`Could not edit Daily Note: ${file.path}`);
        return;
      }
    }

    this.destroyDayPreview(day);
    day.renderGeneration += 1;
    day.file = file;
    day.body.empty();
    day.el.toggleClass("is-missing", !file);
    const editorHost = day.body.createDiv({ cls: "dossier-timeline-editor" });
    const anchor = typeof requestedPosition === "number"
      ? Math.max(0, Math.min(content.length, requestedPosition))
      : requestedPosition === "start"
        ? 0
        : requestedPosition === "end"
          ? content.length
          : findTimelineEditOffset(content, requestedPosition);
    const view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: content,
        selection: { anchor },
        extensions: [
          EditorView.lineWrapping,
          ...timelineEditingExtensions(),
          ...timelineLivePreviewExtensions({
            onLinkClick: ({ target, event }) => this.openTimelineLink(target, file?.path, event),
            onLinkHover: ({ target, event, targetEl }) => this.hoverTimelineLink(target, file?.path, event, targetEl),
            onLinkContext: ({ target, event }) => this.contextTimelineLink(target, file?.path, event),
            onTagClick: (tag) => void this.openTagSearch(tag),
            resolveEmbed: (target) => this.resolveTimelineEmbed(target, file?.path),
          }),
          ...timelineWikiLinkExtensions(
            this.app,
            file?.path ?? this.service.dateToDailyFilePath(day.date),
          ),
          ...timelinePasteDropExtensions(
            this.app,
            file?.path ?? this.service.dateToDailyFilePath(day.date),
          ),
          EditorView.updateListener.of((update) => {
            const active = this.activeEditor;
            if (update.docChanged && active?.day === day && !active.suppressUpdates) {
              if (!active.file) {
                if (hasMeaningfulDeferredDailyContent(update.state.doc.toString())) {
                  void this.materializeEditor(active);
                }
              } else {
                active.dirty = true;
                this.scheduleSave(active);
              }
            }
          }),
          EditorView.domEventHandlers({
            keydown: (event, editorView) => {
              if (event.key !== "Escape") return false;
              if (completionStatus(editorView.state) !== null || searchPanelOpen(editorView.state)) return false;
              event.preventDefault();
              void this.finishEditing();
              return true;
            },
            blur: () => {
              editorHost.win.setTimeout(() => {
                const active = this.activeEditor;
                const focused = editorHost.ownerDocument.activeElement;
                if (active?.day === day && !active.view.hasFocus && !editorHost.contains(focused)) {
                  void this.finishEditing();
                }
              }, 0);
              return false;
            },
          }),
        ],
      }),
    });
    const editor: TimelineEditor = {
      day,
      file,
      view,
      baseContent,
      dirty: false,
      suppressUpdates: false,
    };
    this.activeEditor = editor;
    view.focus();
    if (typeof requestedPosition === "object") {
      await nextAnimationFrame(editorHost.win);
      if (this.activeEditor === editor) placeCaretAtRenderedClick(view, anchor, requestedPosition);
    }
  }

  private scheduleSave(editor: TimelineEditor): void {
    if (editor.saveTimer !== undefined) editor.day.el.win.clearTimeout(editor.saveTimer);
    editor.saveTimer = editor.day.el.win.setTimeout(() => {
      editor.saveTimer = undefined;
      void this.saveEditor(editor);
    }, SAVE_DELAY_MS);
  }

  private async saveEditor(editor: TimelineEditor): Promise<boolean> {
    if (!editor.file) {
      return hasMeaningfulDeferredDailyContent(editor.view.state.doc.toString())
        ? this.materializeEditor(editor)
        : true;
    }
    if (editor.saving) return editor.saving;
    editor.saving = this.performSave(editor).finally(() => {
      editor.saving = undefined;
    });
    return editor.saving;
  }

  private async performSave(editor: TimelineEditor): Promise<boolean> {
    while (editor.dirty) {
      const file = editor.file;
      if (!file) return false;
      editor.dirty = false;
      const nextContent = dailyContentForPersistence(editor.view.state.doc.toString());
      let conflicted = false;
      try {
        const written = await this.app.vault.process(file, (current) => {
          if (current !== editor.baseContent && current !== nextContent) {
            conflicted = true;
            return current;
          }
          return nextContent;
        });
        if (conflicted) {
          editor.dirty = true;
          new Notice("Tradecraft: this Daily Note changed elsewhere. Your inline edits remain open and were not overwritten.");
          return false;
        }
        editor.baseContent = written;
      } catch (error) {
        editor.dirty = true;
        console.error("Tradecraft: failed to save an inline Daily Note", error);
        new Notice(`Could not save Daily Note: ${file.path}`);
        return false;
      }
    }
    return true;
  }

  private async materializeEditor(editor: TimelineEditor): Promise<boolean> {
    if (editor.file) return true;
    if (editor.materializing) return editor.materializing;
    editor.materializing = this.performMaterialize(editor).finally(() => {
      editor.materializing = undefined;
    });
    return editor.materializing;
  }

  private async performMaterialize(editor: TimelineEditor): Promise<boolean> {
    const behavior = this.getSettings().dailyNoteDates.navigator.missingNoteBehavior;
    const initialContent = editor.view.state.doc.toString();
    try {
      const file = await this.resolver.resolve(editor.day.date, behavior);
      if (!file) return false;
      const content = this.activeEditor === editor
        ? editor.view.state.doc.toString()
        : initialContent;
      await this.app.vault.modify(file, content);
      editor.file = file;
      editor.day.file = file;
      editor.day.el.removeClass("is-missing");
      editor.baseContent = content;
      if (this.activeEditor === editor && editor.view.state.doc.toString() !== content) {
        editor.dirty = true;
        this.scheduleSave(editor);
      }
      return true;
    } catch (error) {
      console.error("Tradecraft: failed to create inline Daily Note", error);
      new Notice(`Could not create Daily Note: ${this.service.dateToDailyFilePath(editor.day.date)}`);
      return false;
    }
  }

  private async finishEditing(): Promise<boolean> {
    const editor = this.activeEditor;
    if (!editor) return true;
    if (editor.saveTimer !== undefined) {
      editor.day.el.win.clearTimeout(editor.saveTimer);
      editor.saveTimer = undefined;
    }
    if (editor.materializing && !(await editor.materializing)) return false;
    const saved = await this.saveEditor(editor);
    if (!saved || this.activeEditor !== editor) return saved;
    this.activeEditor = undefined;
    editor.view.destroy();
    await this.renderDay(editor.day);
    return true;
  }

  private async openAsNote(day: TimelineDay, event: MouseEvent): Promise<void> {
    if (!(await this.finishEditing())) return;
    const behavior = this.getSettings().dailyNoteDates.navigator.missingNoteBehavior;
    const file = day.file ?? await this.resolver.resolve(day.date, behavior);
    if (!file) return;
    const leaf = this.app.workspace.getLeaf(Keymap.isModEvent(event) ? true : "tab");
    await leaf.openFile(file, { active: true });
  }

  private openTimelineLink(
    target: string,
    sourcePath: string | undefined,
    event: MouseEvent,
  ): void {
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) {
      this.contentEl.win.open(target, "_blank", "noopener,noreferrer");
      return;
    }
    let linktext = target;
    try {
      linktext = decodeURIComponent(target);
    } catch {
      // Obsidian can still resolve the original link text if it is not valid URI encoding.
    }
    void this.app.workspace.openLinkText(
      linktext,
      sourcePath ?? "",
      Keymap.isModEvent(event),
    );
  }

  private hoverTimelineLink(
    target: string,
    sourcePath: string | undefined,
    event: MouseEvent,
    targetEl: HTMLElement,
  ): void {
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) return;
    this.app.workspace.trigger("hover-link", {
      event,
      source: "dossier",
      hoverParent: this,
      targetEl,
      linktext: target,
      sourcePath: sourcePath ?? "",
    });
  }

  private contextTimelineLink(
    target: string,
    sourcePath: string | undefined,
    event: MouseEvent,
  ): void {
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) return;
    const menu = new Menu();
    if (this.app.workspace.handleLinkContextMenu(menu, target, sourcePath ?? "", this.leaf)) {
      menu.showAtMouseEvent(event);
    }
  }

  private async openTagSearch(tag: string): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: "search",
      active: true,
      state: { query: `tag:#${tag}` },
    });
  }

  private resolveTimelineEmbed(
    target: string,
    sourcePath: string | undefined,
  ): { src: string; kind: "image" | "audio" | "video" | "pdf" } | null {
    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      // Link resolution below can still handle the original text.
    }
    const linkpath = decoded.split("#", 1)[0] ?? decoded;
    if (/^[a-z][a-z\d+.-]*:/i.test(linkpath)) {
      const kind = timelineMediaKind(linkpath);
      return kind ? { src: linkpath, kind } : null;
    }
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath ?? "");
    if (!file) return null;
    const kind = timelineMediaKind(file.path);
    return kind ? { src: this.app.vault.getResourcePath(file), kind } : null;
  }

  private scheduleScrollWork(): void {
    if (!this.scroller || this.scrollFrame !== undefined) return;
    this.scrollFrame = this.scroller.win.requestAnimationFrame(() => {
      this.scrollFrame = undefined;
      this.updateCenterDate();
      const direction = timelineScrollDirection(
        this.scroller!.scrollTop,
        this.scroller!.clientHeight,
        this.scroller!.scrollHeight,
        SCROLL_THRESHOLD,
      );
      if (direction !== 0) void this.extend(direction);
    });
  }

  private updateCenterDate(): void {
    if (!this.scroller) return;
    const target = this.scroller.scrollTop + this.scroller.clientHeight * 0.35;
    let closest: TimelineDay | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const day of this.days.values()) {
      const nextDistance = Math.abs(day.el.offsetTop - target);
      if (nextDistance < distance) {
        distance = nextDistance;
        closest = day;
      }
    }
    if (closest) this.centerKey = closest.key;

    const editor = this.activeEditor;
    if (editor) {
      const top = editor.day.el.offsetTop;
      const bottom = top + editor.day.el.offsetHeight;
      const margin = this.scroller.clientHeight * 1.5;
      if (bottom < this.scroller.scrollTop - margin || top > this.scroller.scrollTop + this.scroller.clientHeight + margin) {
        void this.finishEditing();
      }
    }
  }

  private async extend(direction: -1 | 1): Promise<void> {
    if (this.extending || !this.dateWindow || !this.feed || !this.scroller) return;
    this.extending = true;
    try {
      const oldFirst = this.feed.firstElementChild as HTMLElement | null;
      const oldFirstTop = oldFirst?.offsetTop ?? 0;
      const oldScrollTop = this.scroller.scrollTop;
      const shift = this.dateWindow.shift(direction);
      if (this.activeEditor && shift.removedKeys.includes(this.activeEditor.day.key)) {
        if (!(await this.finishEditing())) return;
      }

      let removedHeight = 0;
      if (direction > 0) {
        for (const key of shift.removedKeys) removedHeight += this.days.get(key)?.el.offsetHeight ?? 0;
      }
      for (const key of shift.removedKeys) this.removeDay(key);

      const renderTasks: Promise<void>[] = [];
      if (direction < 0) {
        const fragment = this.feed.doc.createDocumentFragment();
        for (const key of shift.addedKeys) {
          const day = this.createDay(key);
          fragment.append(day.el);
          renderTasks.push(this.renderDay(day));
        }
        this.feed.prepend(fragment);
      } else {
        for (const key of shift.addedKeys) {
          const day = this.createDay(key);
          this.feed.append(day.el);
          renderTasks.push(this.renderDay(day));
        }
      }
      await Promise.all(renderTasks);
      await nextAnimationFrame(this.scroller.win);
      if (direction < 0 && oldFirst) {
        this.scroller.scrollTop = oldScrollTop + oldFirst.offsetTop - oldFirstTop;
      } else if (direction > 0 && removedHeight > 0) {
        this.scroller.scrollTop = Math.max(0, oldScrollTop - removedHeight);
      }
    } finally {
      this.extending = false;
    }
  }

  private removeDay(key: string): void {
    const day = this.days.get(key);
    if (!day) return;
    this.destroyDayPreview(day);
    day.renderGeneration += 1;
    day.el.remove();
    this.days.delete(key);
  }

  private destroyDayPreview(day: TimelineDay): void {
    day.preview?.destroy();
    day.preview = undefined;
  }

  private refreshPath(path: string): void {
    for (const day of this.days.values()) {
      if (this.service.dateToDailyFilePath(day.date) !== path) continue;
      if (this.activeEditor?.day === day) continue;
      void this.renderDay(day);
    }
  }

  private handleExternalModify(file: TFile): void {
    const editor = this.activeEditor;
    if (editor?.file?.path === file.path) {
      if (editor.saving) return;
      if (editor.dirty) {
        new Notice("Tradecraft: this Daily Note changed elsewhere. Saving will pause until you resolve the inline edit.");
        return;
      }
      void this.reloadEditor(editor);
      return;
    }
    this.refreshPath(file.path);
  }

  private async reloadEditor(editor: TimelineEditor): Promise<void> {
    if (!editor.file) return;
    try {
      const content = await this.app.vault.cachedRead(editor.file);
      if (this.activeEditor !== editor || editor.dirty || content === editor.baseContent) return;
      editor.suppressUpdates = true;
      editor.view.dispatch({
        changes: {
          from: 0,
          to: editor.view.state.doc.length,
          insert: dailyContentForEditing(content),
        },
      });
      editor.suppressUpdates = false;
      editor.baseContent = content;
    } catch (error) {
      editor.suppressUpdates = false;
      console.debug("Tradecraft: could not refresh an externally modified inline note", error);
    }
  }

  private handleDelete(path: string): void {
    const editor = this.activeEditor;
    if (editor?.file?.path === path) {
      if (editor.saveTimer !== undefined) editor.day.el.win.clearTimeout(editor.saveTimer);
      editor.view.destroy();
      this.activeEditor = undefined;
      if (editor.dirty) new Notice("Tradecraft: the Daily Note being edited was deleted; its unsaved inline changes could not be saved.");
    }
    this.refreshPath(path);
  }

  private async handleRename(oldPath: string, newPath: string): Promise<void> {
    const editor = this.activeEditor;
    const editedExpectedPath = editor ? this.service.dateToDailyFilePath(editor.day.date) : null;
    if (editor && editedExpectedPath === oldPath) await this.finishEditing();
    this.refreshPath(oldPath);
    this.refreshPath(newPath);
  }
}

function captureEditIntent(body: HTMLElement, event: MouseEvent): TimelineEditIntent {
  const target = event.target instanceof Element ? event.target : null;
  const blockSelector = "li, p, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th";
  const block = target?.closest<HTMLElement>(blockSelector);
  if (!block || !body.contains(block)) {
    return { renderedText: body.textContent ?? "", characterOffset: 0, blockOrdinal: 0 };
  }

  const blocks = Array.from(body.querySelectorAll<HTMLElement>(blockSelector));
  const clone = block.cloneNode(true) as HTMLElement;
  for (const nestedList of Array.from(clone.querySelectorAll(":scope > ul, :scope > ol"))) nestedList.remove();
  const rawText = clone.textContent ?? "";
  const leadingWhitespace = rawText.length - rawText.trimStart().length;
  const renderedText = rawText.trim();
  const blockRect = block.getBoundingClientRect();
  const characterOffset = Math.max(
    0,
    caretTextOffset(block, event.clientX, event.clientY) - leadingWhitespace,
  );
  const lineElement = block.closest<HTMLElement>("[data-line]");
  const parsedLine = Number(lineElement?.dataset.line);
  return {
    renderedText,
    characterOffset,
    blockOrdinal: Math.max(0, blocks.indexOf(block)),
    sourceLine: Number.isInteger(parsedLine) && parsedLine >= 0 ? parsedLine : undefined,
    clientX: event.clientX,
    blockOffsetY: Math.max(0, event.clientY - blockRect.top),
  };
}

/**
 * Resolve the original rendered click against CodeMirror after it has mounted.
 * The source mapping identifies the logical line; CodeMirror then supplies the
 * exact horizontal character and naturally clamps clicks past the text to the
 * visual line ending.
 */
function placeCaretAtRenderedClick(
  view: EditorView,
  mappedOffset: number,
  intent: TimelineEditIntent,
): void {
  if (!Number.isFinite(intent.clientX) || !Number.isFinite(intent.blockOffsetY)) return;
  const line = view.state.doc.lineAt(mappedOffset);
  const start = view.coordsAtPos(line.from, 1);
  const end = view.coordsAtPos(line.to, -1);
  if (!start && !end) return;

  const top = start?.top ?? end!.top;
  const bottom = Math.max(top + 1, end?.bottom ?? start!.bottom);
  const y = Math.min(bottom - 0.5, Math.max(top + 0.5, top + intent.blockOffsetY!));
  const resolved = view.posAtCoords({ x: intent.clientX!, y }, false);
  const anchor = Math.max(line.from, Math.min(line.to, resolved));
  view.dispatch({
    selection: { anchor },
    scrollIntoView: true,
    userEvent: "select.pointer",
  });
}

function caretTextOffset(block: HTMLElement, x: number, y: number): number {
  const doc = block.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  const positionOffset = textOffsetWithin(block, position?.offsetNode, position?.offset);
  if (positionOffset !== null) return positionOffset;
  const rangeAtPoint = doc.caretRangeFromPoint?.(x, y);
  return textOffsetWithin(block, rangeAtPoint?.startContainer, rangeAtPoint?.startOffset) ?? 0;
}

function textOffsetWithin(
  block: HTMLElement,
  node: Node | undefined,
  offset: number | undefined,
): number | null {
  if (!node || offset === undefined || !block.contains(node)) return null;
  try {
    const range = block.ownerDocument.createRange();
    range.selectNodeContents(block);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function readAnchorKey(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const value = (state as DailyTimelineState).anchorDate;
  if (typeof value !== "string") return null;
  return dailyDateFromKey(value) ? value : null;
}

function nextAnimationFrame(win: Window): Promise<void> {
  return new Promise((resolve) => win.requestAnimationFrame(() => resolve()));
}

function removeTooltipAttributes(element: HTMLElement): void {
  element.removeAttribute("aria-label");
  element.removeAttribute("data-tooltip-position");
  element.removeAttribute("title");
}

function timelineMediaKind(path: string): "image" | "audio" | "video" | "pdf" | null {
  const clean = path.split(/[?#]/, 1)[0]?.toLowerCase() ?? path.toLowerCase();
  if (/\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/.test(clean)) return "image";
  if (/\.(?:flac|m4a|mp3|oga|ogg|wav|webm)$/.test(clean)) return "audio";
  if (/\.(?:mkv|mov|mp4|ogv|webm)$/.test(clean)) return "video";
  if (/\.pdf$/.test(clean)) return "pdf";
  return null;
}
