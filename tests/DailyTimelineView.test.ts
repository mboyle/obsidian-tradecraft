// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS } from "../src/settings/Settings";
import { DailyNoteDisplayService } from "../src/dailyDates/DailyNoteDisplayService";
import { DailyTimelineView } from "../src/dailyDates/DailyTimelineView";

describe("DailyTimelineView", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("opens a bounded rendered feed around its anchor without backlink footers", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const file = makeTFile("Daily/2026-08-20.md");
    const emptyToday = makeTFile("Daily/2026-08-21.md");
    const files = new Map([
      [file.path, file],
      [emptyToday.path, emptyToday],
    ]);
    const contents = new Map([
      [file.path, "- Timeline entry"],
      [emptyToday.path, ""],
    ]);
    const containerEl = document.body.createDiv();
    const contentEl = containerEl.createDiv({ cls: "view-content" });
    const workspace = {
      getLeaf: vi.fn(),
      on: vi.fn(() => ({ unsubscribe: vi.fn() })),
    };
    const vault = {
      on: vi.fn(() => ({ unsubscribe: vi.fn() })),
      getFileByPath: vi.fn((path: string) => files.get(path) ?? null),
      cachedRead: vi.fn(async (target: TFile) => contents.get(target.path) ?? ""),
    };
    const app = { workspace, vault } as unknown as App;
    const leaf = { app, containerEl, contentEl } as unknown as WorkspaceLeaf;
    const service = new DailyNoteDisplayService(() => settings.dailyNoteDates);
    const view = new DailyTimelineView(leaf, service, () => settings);

    await view.setState({ anchorDate: "2026-08-20" }, {} as never);
    await openView(view);

    const days = contentEl.querySelectorAll<HTMLElement>(".dossier-timeline-day");
    expect(days).toHaveLength(15);
    expect(days[0]?.dataset.date).toBe("2026-08-13");
    expect(days[14]?.dataset.date).toBe("2026-08-27");
    expect(contentEl.querySelector('[data-date="2026-08-20"] .dossier-timeline-body')?.textContent)
      .toContain("Timeline entry");
    const missingSurface = contentEl.querySelector<HTMLElement>(
      '[data-date="2026-08-19"] .dossier-timeline-editor.is-readonly',
    );
    expect(missingSurface?.querySelector(".list-bullet")).not.toBeNull();
    expect(missingSurface?.hasAttribute("aria-label")).toBe(false);
    expect(contentEl.querySelector(
      '[data-date="2026-08-20"] .dossier-timeline-editor.is-readonly',
    )).not.toBeNull();
    const emptyExistingSurface = contentEl.querySelector<HTMLElement>(
      '[data-date="2026-08-21"] .dossier-timeline-editor.is-readonly',
    );
    expect(emptyExistingSurface?.querySelector(".list-bullet")).not.toBeNull();

    contentEl.querySelector<HTMLElement>(
      '[data-date="2026-08-21"] .dossier-timeline-title',
    )?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(contentEl.querySelector(
      '[data-date="2026-08-21"] .dossier-timeline-editor:not(.is-readonly) .list-bullet',
    )).not.toBeNull();
    expect(contentEl.querySelector(".dossier-backlinks")).toBeNull();
    expect(vault.getFileByPath).toHaveBeenCalledTimes(15);

    await closeView(view);
    expect(contentEl.querySelector(".dossier-timeline-day")).toBeNull();
  });
});

function openView(view: DailyTimelineView): Promise<void> {
  return (view as unknown as { onOpen(): Promise<void> }).onOpen();
}

function closeView(view: DailyTimelineView): Promise<void> {
  return (view as unknown as { onClose(): Promise<void> }).onClose();
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
  prototype.createDiv ??= function (this: HTMLElement, options?: string | { cls?: string; text?: string }) {
    const element = this.ownerDocument.createElement("div");
    applyOptions(element, options);
    this.appendChild(element);
    return element;
  };
  prototype.createEl ??= function (
    this: HTMLElement,
    tag: string,
    options?: string | { cls?: string; text?: string; attr?: Record<string, string> },
  ) {
    const element = this.ownerDocument.createElement(tag);
    applyOptions(element, options);
    this.appendChild(element);
    return element;
  };
  prototype.empty ??= function (this: HTMLElement) { this.replaceChildren(); };
  prototype.addClass ??= function (this: HTMLElement, ...classes: string[]) { this.classList.add(...classes); };
  prototype.removeClass ??= function (this: HTMLElement, ...classes: string[]) { this.classList.remove(...classes); };
  prototype.toggleClass ??= function (this: HTMLElement, name: string, force?: boolean) {
    this.classList.toggle(name, force);
  };
  Object.defineProperty(HTMLElement.prototype, "win", { configurable: true, get: () => window });
  Object.defineProperty(HTMLElement.prototype, "doc", {
    configurable: true,
    get(this: HTMLElement) { return this.ownerDocument; },
  });
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
