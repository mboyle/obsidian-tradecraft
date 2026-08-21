// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile, type App, type WorkspaceLeaf } from "obsidian";
import type { DossierSettings } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/settings/Settings";
import { DailyNoteDisplayService } from "../src/dailyDates/DailyNoteDisplayService";
import { WeeklyDailyNoteNavigator } from "../src/dailyDates/WeeklyDailyNoteNavigator";

describe("WeeklyDailyNoteNavigator", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    document.body.empty();
    vi.unstubAllGlobals();
  });

  it("renders accessible three-page chrome for an eligible Daily Note", () => {
    const harness = makeHarness(["Daily/2026-08-20.md"]);
    const { host } = harness.addLeaf("Daily/2026-08-20.md", "preview");
    harness.controller.refreshAll();

    const root = host.querySelector<HTMLElement>(".dossier-week-nav")!;
    expect(host.firstElementChild).toBe(root);
    expect(host.hasClass("dossier-week-nav-host")).toBe(true);
    expect(host.hasClass("is-sticky")).toBe(true);
    expect(root.getAttribute("aria-label")).toBe("Daily Note week navigator");
    expect(root.dataset.ignoreSwipe).toBe("true");
    expect(root.querySelectorAll(".dossier-week-nav-page")).toHaveLength(3);
    expect(root.querySelectorAll(".dossier-week-nav-date")).toHaveLength(21);
    expect(currentDates(root)).toEqual([
      "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20",
      "2026-08-21", "2026-08-22", "2026-08-23",
    ]);
    const selected = root.querySelector<HTMLButtonElement>('[data-date="2026-08-20"]')!;
    expect(selected.getAttribute("aria-current")).toBe("date");
    expect(selected.getAttribute("aria-label")).toContain("Thursday, August 20, 2026");
    expect(root.querySelector(".dossier-week-nav-month")?.textContent).toBe("August 2026");
    harness.controller.onunload();
  });

  it("remains independent of readable labels and owns separate state per leaf", () => {
    const harness = makeHarness([
      "Daily/2026-08-20.md",
      "Daily/2026-09-01.md",
    ]);
    harness.settings.dailyNoteDates.enabled = false;
    const first = harness.addLeaf("Daily/2026-08-20.md", "preview");
    const second = harness.addLeaf("Daily/2026-09-01.md", "source");
    harness.controller.refreshAll();

    expect(first.host.querySelector('[aria-current="date"]')?.getAttribute("data-date"))
      .toBe("2026-08-20");
    expect(second.host.querySelector('[aria-current="date"]')?.getAttribute("data-date"))
      .toBe("2026-09-01");
    expect(first.host.querySelectorAll(".dossier-week-nav")).toHaveLength(1);
    expect(second.host.querySelectorAll(".dossier-week-nav")).toHaveLength(1);
    harness.controller.onunload();
  });

  it("preserves a browsed week through mode changes and recenters external dates outside it", () => {
    const harness = makeHarness([
      "Daily/2026-08-20.md",
      "Daily/2026-08-25.md",
      "Daily/2026-10-02.md",
    ]);
    harness.settings.dailyNoteDates.navigator.animation = "none";
    const leaf = harness.addLeaf("Daily/2026-08-20.md", "preview");
    harness.controller.refreshAll();
    const root = () => leaf.host.querySelector<HTMLElement>(".dossier-week-nav")!;

    root().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(currentDates(root())[0]).toBe("2026-08-24");

    setViewMode(leaf.host, "source");
    leaf.view.file = harness.files.get("Daily/2026-08-25.md")!;
    harness.controller.refreshAll();
    expect(currentDates(root())[0]).toBe("2026-08-24");

    leaf.view.file = harness.files.get("Daily/2026-10-02.md")!;
    harness.controller.refreshAll();
    expect(currentDates(root())[0]).toBe("2026-09-28");
    harness.controller.onunload();
  });

  it("supports keyboard week navigation and Home reset", () => {
    const harness = makeHarness(["Daily/2026-08-20.md"]);
    harness.settings.dailyNoteDates.navigator.animation = "none";
    const leaf = harness.addLeaf("Daily/2026-08-20.md", "preview");
    harness.controller.refreshAll();
    const root = leaf.host.querySelector<HTMLElement>(".dossier-week-nav")!;

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(currentDates(root)[0]).toBe("2026-08-10");
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(currentDates(root)[0]).toBe("2026-08-17");
    harness.controller.onunload();
  });

  it("supports horizontal trackpad scrolling while preserving vertical wheel scrolling", () => {
    vi.useFakeTimers();
    try {
      const harness = makeHarness(["Daily/2026-08-20.md"]);
      harness.settings.dailyNoteDates.navigator.animation = "none";
      const leaf = harness.addLeaf("Daily/2026-08-20.md", "preview");
      harness.controller.refreshAll();
      const root = leaf.host.querySelector<HTMLElement>(".dossier-week-nav")!;
      const viewport = root.querySelector<HTMLElement>(".dossier-week-nav-viewport")!;

      const vertical = new WheelEvent("wheel", {
        deltaX: 2,
        deltaY: 80,
        bubbles: true,
        cancelable: true,
      });
      expect(viewport.dispatchEvent(vertical)).toBe(true);
      expect(currentDates(root)[0]).toBe("2026-08-17");

      vi.advanceTimersByTime(181);
      const horizontal = new WheelEvent("wheel", {
        deltaX: 60,
        deltaY: 2,
        bubbles: true,
        cancelable: true,
      });
      expect(viewport.dispatchEvent(horizontal)).toBe(false);
      expect(currentDates(root)[0]).toBe("2026-08-24");

      viewport.dispatchEvent(new WheelEvent("wheel", {
        deltaX: 120,
        bubbles: true,
        cancelable: true,
      }));
      expect(currentDates(root)[0]).toBe("2026-08-24");
      harness.controller.onunload();
    } finally {
      vi.useRealTimers();
    }
  });

  it("claims navigator touch gestures before they reach the surrounding leaf", () => {
    const harness = makeHarness(["Daily/2026-08-20.md"]);
    const leaf = harness.addLeaf("Daily/2026-08-20.md", "preview");
    harness.controller.refreshAll();
    const viewport = leaf.host.querySelector<HTMLElement>(".dossier-week-nav-viewport")!;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 300,
      bottom: 80,
      left: 0,
      width: 300,
      height: 80,
      toJSON: () => ({}),
    });
    const escaped = vi.fn();
    leaf.shell.addEventListener("touchstart", escaped);
    const event = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: [{ clientX: 150 }] });

    viewport.dispatchEvent(event);

    expect(escaped).not.toHaveBeenCalled();
    harness.controller.onunload();
  });

  it("opens today's Daily Note when the month heading is selected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 12));
    try {
      const harness = makeHarness([
        "Daily/2026-02-25.md",
        "Daily/2026-08-20.md",
      ]);
      const leaf = harness.addLeaf("Daily/2026-02-25.md", "preview");
      harness.controller.refreshAll();
      const month = leaf.host.querySelector<HTMLButtonElement>(".dossier-week-nav-month")!;
      expect(month.getAttribute("aria-label")).toBe("Open today, August 20, 2026");
      month.click();
      await Promise.resolve();
      expect(leaf.openFile).toHaveBeenCalledWith(harness.files.get("Daily/2026-08-20.md"), { active: true });
      harness.controller.refreshAll();
      expect(currentDates(leaf.host.querySelector<HTMLElement>(".dossier-week-nav")!)[0])
        .toBe("2026-08-17");
      harness.controller.onunload();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recenters the visible week when today is already open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 12));
    try {
      const harness = makeHarness(["Daily/2026-08-20.md"]);
      harness.settings.dailyNoteDates.navigator.animation = "none";
      const leaf = harness.addLeaf("Daily/2026-08-20.md", "preview");
      harness.controller.refreshAll();
      const root = leaf.host.querySelector<HTMLElement>(".dossier-week-nav")!;

      root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      expect(currentDates(root)[0]).toBe("2026-08-10");

      root.querySelector<HTMLButtonElement>(".dossier-week-nav-month")!.click();
      expect(currentDates(root)[0]).toBe("2026-08-17");
      await Promise.resolve();
      expect(leaf.openFile).toHaveBeenCalledWith(
        harness.files.get("Daily/2026-08-20.md"),
        { active: true },
      );
      harness.controller.onunload();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens dates through the owning leaf and marks existing notes without reads or scans", async () => {
    const harness = makeHarness([
      "Daily/2026-08-20.md",
      "Daily/2026-08-21.md",
    ]);
    harness.settings.dailyNoteDates.navigator.showExistingNoteIndicators = true;
    harness.settings.dailyNoteDates.navigator.missingNoteBehavior = "nothing";
    const leaf = harness.addLeaf("Daily/2026-08-20.md", "preview");
    harness.controller.refreshAll();
    const root = leaf.host.querySelector<HTMLElement>(".dossier-week-nav")!;
    const existing = root.querySelector<HTMLButtonElement>('[data-date="2026-08-21"]')!;
    expect(existing.hasClass("has-existing-note")).toBe(true);
    expect(existing.getAttribute("aria-label")).toContain("note exists");
    existing.click();
    await Promise.resolve();
    expect(leaf.openFile).toHaveBeenCalledWith(harness.files.get("Daily/2026-08-21.md"), { active: true });

    root.querySelector<HTMLButtonElement>('[data-date="2026-08-22"]')!.click();
    await Promise.resolve();
    expect(leaf.openFile).toHaveBeenCalledTimes(1);
    expect(harness.vault.getFileByPath).toHaveBeenCalled();
    harness.controller.onunload();
  });

  it("keeps a missing date virtual until the user enters meaningful content", async () => {
    const harness = makeHarness(["Daily/2026-08-20.md"]);
    harness.settings.dailyNoteDates.navigator.missingNoteBehavior = "blank";
    const leaf = harness.addLeaf("Daily/2026-08-20.md", "preview");
    harness.controller.refreshAll();
    const root = leaf.host.querySelector<HTMLElement>(".dossier-week-nav")!;

    root.querySelector<HTMLButtonElement>('[data-date="2026-08-21"]')!.click();
    await Promise.resolve();

    expect(harness.vault.create).not.toHaveBeenCalled();
    expect(leaf.host.hasClass("has-dossier-deferred-daily")).toBe(true);
    expect(leaf.host.querySelector(".dossier-deferred-daily-title")?.textContent)
      .toBe("Fri, August 21st, 2026");
    expect(leaf.host.querySelector('[aria-current="date"]')?.getAttribute("data-date"))
      .toBe("2026-08-21");

    leaf.host.querySelector<HTMLButtonElement>('[data-date="2026-08-22"]')!.click();
    await Promise.resolve();
    expect(leaf.host.querySelector(".dossier-deferred-daily-title")?.textContent)
      .toBe("Sat, August 22nd, 2026");
    expect(leaf.host.querySelector('[aria-current="date"]')?.getAttribute("data-date"))
      .toBe("2026-08-22");
    expect(leaf.host.querySelector(".dossier-deferred-daily-title")?.hasClass("inline-title"))
      .toBe(false);

    leaf.host.querySelector<HTMLButtonElement>('[data-date="2026-08-20"]')!.click();
    await Promise.resolve();
    expect(harness.vault.create).not.toHaveBeenCalled();
    expect(leaf.host.querySelector(".dossier-deferred-daily")).toBeNull();
    harness.controller.onunload();
  });

  it("projects an automatically created empty Daily Note as the virtual starter", async () => {
    const path = "Daily/2026-08-20.md";
    const harness = makeHarness([path]);
    harness.contents.set(path, "");
    const leaf = harness.addLeaf(path, "source");

    harness.controller.refreshAll();
    await Promise.resolve();
    await Promise.resolve();

    expect(leaf.host.hasClass("has-dossier-deferred-daily")).toBe(true);
    expect(leaf.host.querySelector(".dossier-deferred-daily-title")?.textContent)
      .toBe("Thu, August 20th, 2026");
    expect(leaf.host.querySelector(".dossier-deferred-daily-editor .list-bullet")).not.toBeNull();
    expect(harness.vault.modify).not.toHaveBeenCalled();
    harness.controller.onunload();
  });

  it("switches sticky and scroll-away hosts and cleans up non-Daily leaves", () => {
    const harness = makeHarness(["Daily/2026-08-20.md", "Notes/Other.md"]);
    harness.settings.dailyNoteDates.navigator.sticky = false;
    const leaf = harness.addLeaf("Daily/2026-08-20.md", "preview");
    harness.controller.refreshAll();
    expect(leaf.host.hasClass("is-scrollaway")).toBe(true);
    expect(leaf.host.hasClass("is-sticky")).toBe(false);

    leaf.view.file = harness.files.get("Notes/Other.md")!;
    harness.controller.refreshAll();
    expect(leaf.host.querySelector(".dossier-week-nav")).toBeNull();
    expect(leaf.host.hasClass("dossier-week-nav-host")).toBe(false);
    expect(leaf.host.style.getPropertyValue("--dossier-week-nav-height")).toBe("");
    harness.controller.onunload();
  });
});

function makeHarness(paths: string[]) {
  const settings = structuredClone(DEFAULT_SETTINGS) as DossierSettings;
  settings.dailyNoteDates.folder = "Daily";
  settings.dailyNoteDates.navigator.weekStart = "monday";
  const files = new Map(paths.map((path) => [path, makeTFile(path)]));
  const contents = new Map(paths.map((path) => [path, "Existing content"]));
  const leaves: Array<WorkspaceLeaf & { openFile: ReturnType<typeof vi.fn> }> = [];
  const vault = {
    on: vi.fn(() => ({ unsubscribe: vi.fn() })),
    getFileByPath: vi.fn((path: string) => files.get(path) ?? null),
    getFolderByPath: vi.fn(() => ({ path: "Daily" })),
    getAbstractFileByPath: vi.fn(() => null),
    createFolder: vi.fn(),
    create: vi.fn(),
    cachedRead: vi.fn(async (file: TFile) => contents.get(file.path) ?? ""),
    modify: vi.fn(async (file: TFile, content: string) => {
      contents.set(file.path, content);
    }),
  };
  const workspace = {
    on: vi.fn(() => ({ unsubscribe: vi.fn() })),
    getLeavesOfType: vi.fn(() => leaves),
  };
  const app = { workspace, vault } as unknown as App;
  const service = new DailyNoteDisplayService(() => settings.dailyNoteDates);
  const controller = new WeeklyDailyNoteNavigator(app, service, () => settings);

  return {
    settings,
    files,
    contents,
    vault,
    controller,
    addLeaf(path: string, mode: "preview" | "source") {
      const host = document.createElement("div");
      host.className = "workspace-leaf-content";
      const header = document.createElement("div");
      header.className = "view-header";
      const content = document.createElement("div");
      content.className = "view-content";
      host.append(header, content);
      setViewMode(host, mode);
      document.body.appendChild(host);
      const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
        containerEl: host,
        contentEl: content,
        file: files.get(path) ?? null,
        getMode: () => content.querySelector(".markdown-reading-view") ? "preview" : "source",
      });
      const leaf = {
        view,
        openFile: vi.fn(async (file: TFile) => {
          view.file = file;
        }),
      } as unknown as WorkspaceLeaf & { openFile: ReturnType<typeof vi.fn> };
      leaves.push(leaf);
      return { host: content, shell: host, view, leaf, openFile: leaf.openFile };
    },
  };
}

function setViewMode(host: HTMLElement, mode: "preview" | "source"): void {
  const content = host.hasClass("view-content")
    ? host
    : host.querySelector<HTMLElement>(":scope > .view-content")!;
  content.querySelector(":scope > .markdown-reading-view, :scope > .markdown-source-view")?.remove();
  if (mode === "preview") {
    const reading = document.createElement("div");
    reading.className = "markdown-reading-view";
    const preview = document.createElement("div");
    preview.className = "markdown-preview-view";
    preview.appendChild(document.createElement("div")).className = "markdown-preview-sizer";
    reading.appendChild(preview);
    content.appendChild(reading);
  } else {
    const source = document.createElement("div");
    source.className = "markdown-source-view";
    const scroller = document.createElement("div");
    scroller.className = "cm-scroller";
    scroller.appendChild(document.createElement("div")).className = "cm-sizer";
    source.appendChild(scroller);
    content.appendChild(source);
  }
}

function currentDates(root: HTMLElement): string[] {
  const page = root.querySelector<HTMLElement>(".dossier-week-nav-page:not([aria-hidden])")!;
  return Array.from(page.querySelectorAll<HTMLElement>(".dossier-week-nav-date"))
    .map((button) => button.dataset.date!);
}

function makeTFile(path: string): TFile {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return Object.assign(Object.create(TFile.prototype) as TFile, {
    path,
    name,
    basename: dot < 0 ? name : name.slice(0, dot),
    extension: dot < 0 ? "" : name.slice(dot + 1),
  });
}

function installObsidianDomHelpers(): void {
  const prototype = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (!prototype.createDiv) {
    prototype.createDiv = function (this: HTMLElement, options?: string | { cls?: string; text?: string }) {
      const div = this.ownerDocument.createElement("div");
      applyOptions(div, options);
      this.appendChild(div);
      return div;
    };
    prototype.createEl = function (
      this: HTMLElement,
      tag: string,
      options?: string | { cls?: string; text?: string; attr?: Record<string, string> },
    ) {
      const element = this.ownerDocument.createElement(tag);
      applyOptions(element, options);
      this.appendChild(element);
      return element;
    };
    prototype.createSpan = function (this: HTMLElement, options?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
      const span = this.ownerDocument.createElement("span");
      applyOptions(span, options);
      this.appendChild(span);
      return span;
    };
    prototype.empty = function (this: HTMLElement) { this.replaceChildren(); };
    prototype.addClass = function (this: HTMLElement, ...classes: string[]) { this.classList.add(...classes); };
    prototype.removeClass = function (this: HTMLElement, ...classes: string[]) { this.classList.remove(...classes); };
    prototype.toggleClass = function (this: HTMLElement, name: string, force?: boolean) {
      this.classList.toggle(name, force);
    };
    prototype.hasClass = function (this: HTMLElement, name: string) { return this.classList.contains(name); };
    prototype.detach = function (this: HTMLElement) { this.remove(); };
    Object.defineProperty(HTMLElement.prototype, "win", { configurable: true, get: () => window });
    Object.defineProperty(HTMLElement.prototype, "doc", {
      configurable: true,
      get(this: HTMLElement) { return this.ownerDocument; },
    });
  }
}

function applyOptions(
  element: HTMLElement,
  options?: string | { cls?: string; text?: string; attr?: Record<string, string> },
): void {
  if (typeof options === "string") element.className = options;
  else if (options) {
    if (options.cls) element.className = options.cls;
    if (options.text !== undefined) element.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
  }
}
