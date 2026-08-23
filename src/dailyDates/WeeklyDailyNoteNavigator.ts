import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Component, MarkdownView, Notice, type App, type WorkspaceLeaf } from "obsidian";
import type { Moment } from "moment";
import type { DossierSettings } from "../types";
import type { DailyNoteDisplayService } from "./DailyNoteDisplayService";
import { DailyNoteFileResolver, todayAtStartOfDay } from "./DailyNoteFileResolver";
import {
  DEFERRED_DAILY_NOTE_STARTER,
  hasMeaningfulDeferredDailyContent,
} from "./DeferredDailyNote";
import { timelineLivePreviewExtensions } from "./TimelineLivePreview";
import {
  dailyDateFromKey,
  dailyDateKey,
  dailyWeekDates,
  decideWeekSwipe,
  isSwipeStartAllowed,
  isDateInWeek,
  monthForDisplayedWeek,
  startOfDailyWeek,
  swipeIntent,
} from "./DailyWeek";

const DEAD_ZONE = 10;
const EDGE_EXCLUSION = 20;
const ANIMATION_MS = 220;
const WHEEL_COMMIT_DISTANCE = 48;
const WHEEL_IDLE_MS = 180;

interface LeafNavigatorState {
  selectedKey: string;
  visibleWeekKey: string;
  pendingInternalKey?: string;
  operationGeneration: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  deltaX: number;
  deltaY: number;
  intent: "pending" | "horizontal" | "vertical";
}

interface NavigatorBinding {
  leaf: WorkspaceLeaf;
  view: MarkdownView;
  root: HTMLElement;
  monthButton: HTMLButtonElement;
  viewport: HTMLElement;
  track: HTMLElement;
  observer: MutationObserver;
  resizeObserver?: ResizeObserver;
  scrollEl?: HTMLElement;
  scrollHandler?: () => void;
  drag?: DragState;
  settleTimer?: number;
  wheelResetTimer?: number;
  wheelDeltaX: number;
  wheelDeltaY: number;
  wheelLocked: boolean;
  touchClaimed: boolean;
  suppressClickUntil: number;
  emptyFileProbeGeneration: number;
  deferred?: DeferredDailyNote;
}

interface DeferredDailyNote {
  date: Moment;
  key: string;
  baseFilePath: string;
  root: HTMLElement;
  editor: EditorView;
  creating: boolean;
}

export class WeeklyDailyNoteNavigator extends Component {
  private readonly bindings = new Map<WorkspaceLeaf, NavigatorBinding>();
  private readonly states = new Map<WorkspaceLeaf, LeafNavigatorState>();
  private readonly resolver: DailyNoteFileResolver;
  private frame?: number;

  constructor(
    private readonly app: App,
    private readonly service: DailyNoteDisplayService,
    private readonly getSettings: () => DossierSettings,
  ) {
    super();
    this.resolver = new DailyNoteFileResolver(app, service, () => getSettings().dailyNoteDates);
  }

  onload(): void {
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("css-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.scheduleRefresh();
  }

  onunload(): void {
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    for (const binding of this.bindings.values()) this.destroyBinding(binding);
    this.bindings.clear();
    this.states.clear();
  }

  refreshAll(): void {
    const settings = this.getSettings().dailyNoteDates;
    const currentLeaves = new Set<WorkspaceLeaf>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      currentLeaves.add(leaf);
      if (!(leaf.view instanceof MarkdownView)) {
        this.removeBinding(leaf);
        continue;
      }
      const view = leaf.view;
      let binding = this.bindings.get(leaf);
      if (binding && (binding.view !== view || binding.root.parentElement !== view.contentEl)) {
        this.destroyBinding(binding);
        this.bindings.delete(leaf);
        binding = undefined;
      }
      if (binding?.deferred && binding.deferred.baseFilePath !== view.file?.path) {
        this.destroyDeferred(binding);
      }
      const selected = binding?.deferred?.date
        ?? (view.file ? this.service.getDailyNoteDate(view.file) : null);
      if (!settings.navigator.enabled || !selected) {
        this.removeBinding(leaf);
        continue;
      }

      if (!binding) {
        binding = this.createBinding(leaf, view);
        this.bindings.set(leaf, binding);
      }
      this.syncState(leaf, selected);
      this.applyLayout(binding);
      this.render(binding);
      this.updateMeasuredHeight(binding);
      this.reconcileEmptyExistingNote(binding);
    }

    for (const leaf of [...this.bindings.keys()]) {
      if (!currentLeaves.has(leaf)) this.removeBinding(leaf);
    }
    for (const leaf of [...this.states.keys()]) {
      if (!currentLeaves.has(leaf)) this.states.delete(leaf);
    }
  }

  private scheduleRefresh(): void {
    if (this.frame !== undefined) return;
    const win = this.app.workspace.containerEl?.win ?? window;
    this.frame = win.requestAnimationFrame(() => {
      this.frame = undefined;
      this.refreshAll();
    });
  }

  private syncState(leaf: WorkspaceLeaf, selected: Moment): void {
    const selectedKey = dailyDateKey(selected);
    const settings = this.getSettings().dailyNoteDates.navigator;
    const existing = this.states.get(leaf);
    if (!existing) {
      this.states.set(leaf, {
        selectedKey,
        visibleWeekKey: dailyDateKey(startOfDailyWeek(selected, settings.weekStart)),
        operationGeneration: 0,
      });
      return;
    }
    if (existing.selectedKey === selectedKey) return;

    existing.operationGeneration += 1;
    const visible = dailyDateFromKey(existing.visibleWeekKey);
    const internal = existing.pendingInternalKey === selectedKey;
    existing.pendingInternalKey = undefined;
    existing.selectedKey = selectedKey;
    if (!internal && (!visible || !isDateInWeek(selected, visible))) {
      existing.visibleWeekKey = dailyDateKey(startOfDailyWeek(selected, settings.weekStart));
    }
  }

  private createBinding(leaf: WorkspaceLeaf, view: MarkdownView): NavigatorBinding {
    const doc = view.contentEl.ownerDocument;
    const root = doc.createElement("section");
    root.className = "dossier-week-nav";
    root.setAttribute("aria-label", "Daily Note week navigator");
    root.dataset.ignoreSwipe = "true";
    root.tabIndex = -1;
    const inner = root.createDiv({ cls: "dossier-week-nav-inner" });
    const monthButton = inner.createEl("button", {
      cls: "dossier-week-nav-month",
      attr: { type: "button" },
    });
    const viewport = inner.createDiv({ cls: "dossier-week-nav-viewport" });
    const track = viewport.createDiv({ cls: "dossier-week-nav-track" });
    view.contentEl.prepend(root);

    const binding: NavigatorBinding = {
      leaf,
      view,
      root,
      monthButton,
      viewport,
      track,
      observer: new MutationObserver(() => this.scheduleRefresh()),
      wheelDeltaX: 0,
      wheelDeltaY: 0,
      wheelLocked: false,
      touchClaimed: false,
      suppressClickUntil: 0,
      emptyFileProbeGeneration: 0,
    };
    binding.observer.observe(view.contentEl, { childList: true });
    if (typeof ResizeObserver !== "undefined") {
      binding.resizeObserver = new ResizeObserver(() => this.updateMeasuredHeight(binding));
      binding.resizeObserver.observe(root);
    }
    monthButton.addEventListener("click", () => this.returnToCurrentWeekAndOpenToday(binding));
    root.addEventListener("keydown", (event) => this.onKeyDown(binding, event));
    root.addEventListener("click", (event) => {
      if (Date.now() < binding.suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    viewport.addEventListener("pointerdown", (event) => this.onPointerDown(binding, event));
    viewport.addEventListener("pointermove", (event) => this.onPointerMove(binding, event));
    viewport.addEventListener("pointerup", (event) => this.onPointerUp(binding, event));
    viewport.addEventListener("pointercancel", (event) => this.onPointerCancel(binding, event));
    viewport.addEventListener("touchstart", (event) => this.onTouchStart(binding, event), { passive: true });
    viewport.addEventListener("touchmove", (event) => this.onTouchContinue(binding, event), { passive: true });
    viewport.addEventListener("touchend", (event) => this.onTouchEnd(binding, event), { passive: true });
    viewport.addEventListener("touchcancel", (event) => this.onTouchEnd(binding, event), { passive: true });
    viewport.addEventListener("wheel", (event) => this.onWheel(binding, event), { passive: false });
    return binding;
  }

  private removeBinding(leaf: WorkspaceLeaf): void {
    const binding = this.bindings.get(leaf);
    if (!binding) return;
    this.destroyBinding(binding);
    this.bindings.delete(leaf);
  }

  private destroyBinding(binding: NavigatorBinding): void {
    binding.emptyFileProbeGeneration += 1;
    this.destroyDeferred(binding);
    binding.observer.disconnect();
    binding.resizeObserver?.disconnect();
    this.unbindScroll(binding);
    if (binding.settleTimer !== undefined) binding.root.win.clearTimeout(binding.settleTimer);
    if (binding.wheelResetTimer !== undefined) binding.root.win.clearTimeout(binding.wheelResetTimer);
    binding.root.detach();
    const host = binding.view.contentEl;
    host.removeClass("dossier-week-nav-host", "is-sticky", "is-scrollaway");
    host.style.removeProperty("--dossier-week-nav-height");
  }

  private applyLayout(binding: NavigatorBinding): void {
    const sticky = this.getSettings().dailyNoteDates.navigator.sticky;
    const host = binding.view.contentEl;
    host.addClass("dossier-week-nav-host");
    host.toggleClass("is-sticky", sticky);
    host.toggleClass("is-scrollaway", !sticky);
    binding.root.style.removeProperty("transform");
    binding.root.style.removeProperty("visibility");
    if (sticky || binding.deferred) this.unbindScroll(binding);
    else this.bindScroll(binding);
    this.updateMeasuredHeight(binding);
  }

  private updateMeasuredHeight(binding: NavigatorBinding): void {
    const height = Math.ceil(binding.root.getBoundingClientRect().height);
    if (height > 0) {
      binding.view.contentEl.style.setProperty("--dossier-week-nav-height", `${height}px`);
      binding.scrollHandler?.();
    }
  }

  private bindScroll(binding: NavigatorBinding): void {
    const selector = binding.view.getMode() === "preview" ? ".markdown-preview-view" : ".cm-scroller";
    const scrollEl = binding.view.contentEl.querySelector<HTMLElement>(selector);
    if (binding.scrollEl === scrollEl) return;
    this.unbindScroll(binding);
    if (!scrollEl) return;
    const handler = () => {
      const height = binding.root.getBoundingClientRect().height;
      const offset = Math.min(scrollEl.scrollTop, height);
      binding.root.setCssStyles({
        transform: `translate3d(0, ${-offset}px, 0)`,
        visibility: offset >= height && height > 0 ? "hidden" : "visible",
      });
    };
    binding.scrollEl = scrollEl;
    binding.scrollHandler = handler;
    scrollEl.addEventListener("scroll", handler, { passive: true });
    handler();
  }

  private unbindScroll(binding: NavigatorBinding): void {
    if (binding.scrollEl && binding.scrollHandler) {
      binding.scrollEl.removeEventListener("scroll", binding.scrollHandler);
    }
    binding.scrollEl = undefined;
    binding.scrollHandler = undefined;
  }

  private render(binding: NavigatorBinding): void {
    const state = this.states.get(binding.leaf);
    if (!state) return;
    const selected = dailyDateFromKey(state.selectedKey);
    const visible = dailyDateFromKey(state.visibleWeekKey);
    if (!selected || !visible) return;
    const settings = this.getSettings().dailyNoteDates.navigator;
    const monthDate = monthForDisplayedWeek(selected, visible);
    binding.monthButton.textContent = monthDate.format("MMMM YYYY");
    const today = todayAtStartOfDay();
    binding.monthButton.setAttribute("aria-label", `Open today, ${today.format("MMMM D, YYYY")}`);
    binding.monthButton.toggleAttribute("hidden", !settings.showMonthHeader);
    binding.root.toggleClass("has-month-header", settings.showMonthHeader);

    binding.track.empty();
    for (const offset of [-1, 0, 1]) {
      const pageStart = visible.clone().add(offset * 7, "days");
      const page = binding.track.createDiv({ cls: "dossier-week-nav-page" });
      page.toggleAttribute("aria-hidden", offset !== 0);
      if (offset !== 0) page.inert = true;
      for (const date of dailyWeekDates(pageStart)) {
        page.appendChild(this.createDateButton(binding, date, selected, offset === 0));
      }
    }
    binding.track.setCssStyles({
      transition: "none",
      transform: "translate3d(-33.333333%, 0, 0)",
    });
    binding.root.removeClass("is-dragging", "is-settling");
  }

  private createDateButton(
    binding: NavigatorBinding,
    date: Moment,
    selected: Moment,
    currentPage: boolean,
  ): HTMLButtonElement {
    const settings = this.getSettings().dailyNoteDates.navigator;
    const button = binding.root.doc.createElement("button");
    button.type = "button";
    button.className = "dossier-week-nav-date";
    button.dataset.date = dailyDateKey(date);
    button.tabIndex = currentPage ? 0 : -1;
    const isSelected = dailyDateKey(date) === dailyDateKey(selected);
    const isToday = dailyDateKey(date) === dailyDateKey(todayAtStartOfDay());
    const exists = settings.showExistingNoteIndicators
      && this.app.vault.getFileByPath(this.service.dateToDailyFilePath(date)) !== null;
    button.toggleClass("is-selected", isSelected);
    button.toggleClass("is-today", settings.showTodayIndicator && isToday && !isSelected);
    button.toggleClass("has-existing-note", exists);
    if (isSelected) button.setAttribute("aria-current", "date");
    const statuses = [
      isSelected ? "selected" : "",
      isToday ? "today" : "",
      exists ? "note exists" : "",
    ].filter(Boolean);
    button.setAttribute(
      "aria-label",
      `${date.format("dddd, MMMM D, YYYY")}${statuses.length ? `, ${statuses.join(", ")}` : ""}`,
    );
    button.createSpan({ cls: "dossier-week-nav-weekday", text: date.format("ddd") });
    button.createSpan({ cls: "dossier-week-nav-day", text: date.format("D") });
    button.createSpan({ cls: "dossier-week-nav-indicators", attr: { "aria-hidden": "true" } });
    button.addEventListener("click", () => void this.openDate(binding, date));
    return button;
  }

  private async openDate(
    binding: NavigatorBinding,
    date: Moment,
    retainVisibleWeek = true,
  ): Promise<void> {
    const state = this.states.get(binding.leaf);
    if (!state) return;
    if (binding.deferred?.key === dailyDateKey(date)) {
      binding.deferred.editor.focus();
      return;
    }
    const operation = ++state.operationGeneration;
    const behavior = this.getSettings().dailyNoteDates.navigator.missingNoteBehavior;
    const file = this.app.vault.getFileByPath(this.service.dateToDailyFilePath(date));
    if (!file) {
      if (behavior !== "nothing") this.showDeferred(binding, date, retainVisibleWeek);
      return;
    }
    this.destroyDeferred(binding);
    if (state.operationGeneration !== operation || this.bindings.get(binding.leaf) !== binding) return;
    state.pendingInternalKey = retainVisibleWeek ? dailyDateKey(date) : undefined;
    try {
      await binding.leaf.openFile(file, { active: true });
    } catch (error) {
      state.pendingInternalKey = undefined;
      console.error("Tradecraft: failed to open Daily Note", error);
    }
  }

  /**
   * Obsidian's Daily Notes core plugin may create today's file before Tradecraft loads.
   * Present that semantically empty file through the same deferred surface as a
   * missing note, so the starter remains virtual until meaningful input exists.
   */
  private reconcileEmptyExistingNote(binding: NavigatorBinding): void {
    const file = binding.view.file;
    const date = file ? this.service.getDailyNoteDate(file) : null;
    const generation = ++binding.emptyFileProbeGeneration;
    if (!file || !date || binding.deferred) return;

    void this.app.vault.cachedRead(file).then((content) => {
      if (
        generation !== binding.emptyFileProbeGeneration
        || this.bindings.get(binding.leaf) !== binding
        || binding.view.file?.path !== file.path
        || binding.deferred
        || hasMeaningfulDeferredDailyContent(content)
      ) return;
      this.showDeferred(binding, date, true);
    }).catch((error) => {
      console.debug("Tradecraft: could not inspect an empty Daily Note", error);
    });
  }

  private showDeferred(
    binding: NavigatorBinding,
    date: Moment,
    retainVisibleWeek: boolean,
  ): void {
    const state = this.states.get(binding.leaf);
    const baseFilePath = binding.view.file?.path;
    if (!state || !baseFilePath) return;
    this.destroyDeferred(binding);

    const key = dailyDateKey(date);
    state.selectedKey = key;
    if (!retainVisibleWeek) {
      state.visibleWeekKey = dailyDateKey(startOfDailyWeek(
        date,
        this.getSettings().dailyNoteDates.navigator.weekStart,
      ));
    }

    const root = binding.root.doc.createElement("section");
    root.className = "dossier-deferred-daily";
    root.setAttribute("aria-label", `Unsaved Daily Note for ${date.format("MMMM D, YYYY")}`);
    const content = root.createDiv({ cls: "dossier-deferred-daily-content" });
    content.createDiv({
      cls: "dossier-deferred-daily-title",
      text: date.format(this.getSettings().dailyNoteDates.titleFormat),
    });
    const editorHost = content.createDiv({
      cls: "dossier-deferred-daily-editor dossier-timeline-editor",
    });
    binding.root.insertAdjacentElement("afterend", root);
    binding.view.contentEl.addClass("has-dossier-deferred-daily");

    const editor = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: DEFERRED_DAILY_NOTE_STARTER,
        selection: { anchor: DEFERRED_DAILY_NOTE_STARTER.length },
        extensions: [
          EditorView.lineWrapping,
          ...timelineLivePreviewExtensions({
            onLinkClick: ({ target, event }) => {
              let linktext = target;
              try {
                linktext = decodeURIComponent(target);
              } catch {
                // Obsidian can still resolve the original link text if it is not valid URI encoding.
              }
              void this.app.workspace.openLinkText(
                linktext,
                baseFilePath,
                event.metaKey || event.ctrlKey,
              );
            },
          }),
          EditorView.updateListener.of((update) => {
            const deferred = binding.deferred;
            if (
              update.docChanged
              && deferred
              && deferred.editor === update.view
              && hasMeaningfulDeferredDailyContent(update.state.doc.toString())
            ) {
              void this.materializeDeferred(binding, deferred);
            }
          }),
        ],
      }),
    });
    binding.deferred = { date: date.clone(), key, baseFilePath, root, editor, creating: false };
    this.applyLayout(binding);
    this.render(binding);
  }

  private async materializeDeferred(
    binding: NavigatorBinding,
    deferred: DeferredDailyNote,
  ): Promise<void> {
    if (deferred.creating || binding.deferred !== deferred) return;
    deferred.creating = true;
    deferred.root.addClass("is-creating");
    const initialContent = deferred.editor.state.doc.toString();
    const behavior = this.getSettings().dailyNoteDates.navigator.missingNoteBehavior;

    try {
      const file = await this.resolver.resolve(deferred.date, behavior);
      if (!file) throw new Error("Daily Note creation was cancelled");
      let current = binding.deferred === deferred;
      let content = current ? deferred.editor.state.doc.toString() : initialContent;
      let anchor = current ? deferred.editor.state.selection.main.head : content.length;
      let pendingContent: string | undefined = content;
      while (pendingContent !== undefined) {
        content = pendingContent;
        await this.app.vault.modify(file, content);
        current = binding.deferred === deferred;
        if (!current) break;
        const latest = deferred.editor.state.doc.toString();
        pendingContent = latest === content ? undefined : latest;
        if (pendingContent !== undefined) anchor = deferred.editor.state.selection.main.head;
      }
      if (!current || binding.deferred !== deferred) return;

      const state = this.states.get(binding.leaf);
      if (state) state.pendingInternalKey = deferred.key;
      this.destroyDeferred(binding);
      await binding.leaf.openFile(file, { active: true });
      binding.root.win.requestAnimationFrame(() => {
        const opened = binding.leaf.view;
        if (!(opened instanceof MarkdownView) || opened.file?.path !== file.path) return;
        const position = editorPositionAtOffset(content, anchor);
        opened.editor.setCursor(position);
        if (opened.getMode() === "source") opened.editor.focus();
      });
    } catch (error) {
      if (binding.deferred === deferred) {
        deferred.creating = false;
        deferred.root.removeClass("is-creating");
      }
      console.error("Tradecraft: failed to create deferred Daily Note", error);
      new Notice(`Could not create Daily Note: ${this.service.dateToDailyFilePath(deferred.date)}`);
    }
  }

  private destroyDeferred(binding: NavigatorBinding): void {
    const deferred = binding.deferred;
    if (!deferred) return;
    binding.deferred = undefined;
    deferred.editor.destroy();
    deferred.root.remove();
    binding.view.contentEl.removeClass("has-dossier-deferred-daily");
  }

  private returnToSelectedWeek(binding: NavigatorBinding): void {
    const state = this.states.get(binding.leaf);
    const selected = state ? dailyDateFromKey(state.selectedKey) : null;
    if (!state || !selected) return;
    state.visibleWeekKey = dailyDateKey(startOfDailyWeek(
      selected,
      this.getSettings().dailyNoteDates.navigator.weekStart,
    ));
    this.render(binding);
  }

  private returnToCurrentWeekAndOpenToday(binding: NavigatorBinding): void {
    const state = this.states.get(binding.leaf);
    if (!state) return;
    const today = todayAtStartOfDay();
    state.visibleWeekKey = dailyDateKey(startOfDailyWeek(
      today,
      this.getSettings().dailyNoteDates.navigator.weekStart,
    ));
    this.render(binding);
    void this.openDate(binding, today, false);
  }

  private changeWeek(binding: NavigatorBinding, direction: -1 | 1, animate: boolean): void {
    const state = this.states.get(binding.leaf);
    const visible = state ? dailyDateFromKey(state.visibleWeekKey) : null;
    if (!state || !visible) return;
    const focused = binding.root.doc.activeElement;
    const focusedDate = focused?.closest<HTMLElement>(".dossier-week-nav-date")?.dataset.date;
    const focusedIndex = focusedDate
      ? currentPageButtons(binding).findIndex((button) => button.dataset.date === focusedDate)
      : -1;
    const shouldAnimate = animate && this.shouldAnimate(binding);
    const commit = () => {
      state.visibleWeekKey = dailyDateKey(visible.add(direction * 7, "days"));
      this.render(binding);
      if (focusedIndex >= 0) currentPageButtons(binding)[focusedIndex]?.focus();
    };
    if (!shouldAnimate) {
      commit();
      return;
    }
    binding.root.addClass("is-settling");
    binding.track.setCssStyles({
      transition: `transform ${ANIMATION_MS}ms ease-out`,
      transform: direction > 0
        ? "translate3d(-66.666667%, 0, 0)"
        : "translate3d(0, 0, 0)",
    });
    if (binding.settleTimer !== undefined) binding.root.win.clearTimeout(binding.settleTimer);
    binding.settleTimer = binding.root.win.setTimeout(commit, ANIMATION_MS);
  }

  private shouldAnimate(binding: NavigatorBinding): boolean {
    if (this.getSettings().dailyNoteDates.navigator.animation === "none") return false;
    return !binding.root.win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  private onKeyDown(binding: NavigatorBinding, event: KeyboardEvent): void {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      this.changeWeek(binding, event.key === "ArrowRight" ? 1 : -1, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      this.returnToSelectedWeek(binding);
    }
  }

  private onPointerDown(binding: NavigatorBinding, event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || binding.root.hasClass("is-settling")) return;
    const rect = binding.viewport.getBoundingClientRect();
    const offset = event.clientX - rect.left;
    if (!isSwipeStartAllowed(offset, rect.width, EDGE_EXCLUSION)) return;
    event.stopPropagation();
    binding.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      deltaX: 0,
      deltaY: 0,
      intent: "pending",
    };
  }

  private onPointerMove(binding: NavigatorBinding, event: PointerEvent): void {
    const drag = binding.drag;
    if (!drag || drag.pointerId !== event.pointerId || drag.intent === "vertical") return;
    event.stopPropagation();
    drag.deltaX = event.clientX - drag.startX;
    drag.deltaY = event.clientY - drag.startY;
    if (drag.intent === "pending") {
      drag.intent = swipeIntent(drag.deltaX, drag.deltaY, DEAD_ZONE);
      if (drag.intent === "pending") return;
      if (drag.intent === "vertical") return;
      try {
        binding.viewport.setPointerCapture?.(event.pointerId);
      } catch {
        // Some WKWebView versions reject capture on an ancestor of the pointer target.
      }
      binding.root.addClass("is-dragging");
      binding.track.setCssStyles({ transition: "none" });
    }
    event.preventDefault();
    const width = binding.viewport.getBoundingClientRect().width;
    const delta = Math.max(-width, Math.min(width, drag.deltaX));
    binding.track.setCssStyles({
      transform: `translate3d(calc(-33.333333% + ${delta}px), 0, 0)`,
    });
  }

  private onPointerUp(binding: NavigatorBinding, event: PointerEvent): void {
    const drag = binding.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    binding.drag = undefined;
    if (drag.intent !== "horizontal") return;
    event.preventDefault();
    binding.suppressClickUntil = Date.now() + 350;
    try {
      if (binding.viewport.hasPointerCapture?.(event.pointerId)) {
        binding.viewport.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Losing capture during native gesture arbitration is harmless.
    }
    const direction = decideWeekSwipe({
      deltaX: drag.deltaX,
      deltaY: drag.deltaY,
      width: binding.viewport.getBoundingClientRect().width,
      elapsedMs: event.timeStamp - drag.startTime,
    });
    binding.root.removeClass("is-dragging");
    if (direction === 0) this.snapToCurrent(binding);
    else this.changeWeek(binding, direction, true);
  }

  private onPointerCancel(binding: NavigatorBinding, event: PointerEvent): void {
    if (binding.drag?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    binding.drag = undefined;
    binding.root.removeClass("is-dragging");
    this.snapToCurrent(binding);
  }

  private onTouchStart(binding: NavigatorBinding, event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch) return;
    const rect = binding.viewport.getBoundingClientRect();
    const offset = touch.clientX - rect.left;
    binding.touchClaimed = isSwipeStartAllowed(offset, rect.width, EDGE_EXCLUSION);
    if (binding.touchClaimed) event.stopPropagation();
  }

  private onTouchContinue(binding: NavigatorBinding, event: TouchEvent): void {
    if (binding.touchClaimed) event.stopPropagation();
  }

  private onTouchEnd(binding: NavigatorBinding, event: TouchEvent): void {
    if (!binding.touchClaimed) return;
    event.stopPropagation();
    binding.touchClaimed = false;
  }

  private onWheel(binding: NavigatorBinding, event: WheelEvent): void {
    if (event.ctrlKey || binding.root.hasClass("is-settling")) return;
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(binding.viewport.clientWidth, 1)
        : 1;
    binding.wheelDeltaX += event.deltaX * scale;
    binding.wheelDeltaY += event.deltaY * scale;

    if (binding.wheelResetTimer !== undefined) {
      binding.root.win.clearTimeout(binding.wheelResetTimer);
    }
    binding.wheelResetTimer = binding.root.win.setTimeout(() => {
      binding.wheelDeltaX = 0;
      binding.wheelDeltaY = 0;
      binding.wheelLocked = false;
      binding.wheelResetTimer = undefined;
    }, WHEEL_IDLE_MS);

    if (Math.abs(binding.wheelDeltaX) <= Math.abs(binding.wheelDeltaY)) return;
    event.preventDefault();
    if (binding.wheelLocked || Math.abs(binding.wheelDeltaX) < WHEEL_COMMIT_DISTANCE) return;
    binding.wheelLocked = true;
    this.changeWeek(binding, binding.wheelDeltaX > 0 ? 1 : -1, true);
  }

  private snapToCurrent(binding: NavigatorBinding): void {
    if (!this.shouldAnimate(binding)) {
      binding.track.setCssStyles({
        transition: "none",
        transform: "translate3d(-33.333333%, 0, 0)",
      });
      return;
    }
    binding.track.setCssStyles({
      transition: `transform ${ANIMATION_MS}ms ease-out`,
      transform: "translate3d(-33.333333%, 0, 0)",
    });
  }
}

function editorPositionAtOffset(content: string, requestedOffset: number): { line: number; ch: number } {
  const offset = Math.max(0, Math.min(content.length, requestedOffset));
  const before = content.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length - 1, ch: lines.at(-1)?.length ?? 0 };
}

function currentPageButtons(binding: NavigatorBinding): HTMLButtonElement[] {
  const page = binding.track.querySelector<HTMLElement>(".dossier-week-nav-page:not([aria-hidden])");
  return page ? Array.from(page.querySelectorAll<HTMLButtonElement>(".dossier-week-nav-date")) : [];
}
