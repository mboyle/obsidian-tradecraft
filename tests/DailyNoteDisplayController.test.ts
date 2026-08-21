// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { DossierSettings } from "../src/types";

const obsidianMocks = vi.hoisted(() => {
  class Component {
    registerEvent(): void {}
  }
  class TFile {
    path: string;
    basename: string;
    extension: string;

    constructor(path: string) {
      this.path = path;
      const name = path.slice(path.lastIndexOf("/") + 1);
      const dot = name.lastIndexOf(".");
      this.basename = dot < 0 ? name : name.slice(0, dot);
      this.extension = dot < 0 ? "" : name.slice(dot + 1);
    }
  }
  class MarkdownView {
    constructor(public containerEl: HTMLElement, public file: TFile | null) {}
  }
  return { Component, MarkdownView, TFile };
});

vi.mock("obsidian", () => obsidianMocks);

import { DailyNoteDisplayController } from "../src/dailyDates/DailyNoteDisplayController";

describe("DailyNoteDisplayController", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("formats and reversibly restores explorer, inline-title, and tab labels", async () => {
    const dailyFile = new obsidianMocks.TFile("Daily/2026-08-20.md");
    const files = new Map([[dailyFile.path, dailyFile]]);
    const explorer = document.createElement("div");
    explorer.innerHTML = `
      <div class="nav-files-container">
        <div class="nav-file-title" data-path="Daily/2026-08-20.md">
          <div class="nav-file-title-content">2026-08-20</div>
        </div>
      </div>`;
    const markdown = document.createElement("div");
    markdown.innerHTML = '<div class="inline-title" contenteditable="true" tabindex="0">2026-08-20</div>';
    const tab = document.createElement("div");
    tab.setAttribute("aria-label", "2026-08-20");
    tab.innerHTML = '<div class="workspace-tab-header-inner-title">2026-08-20</div>';
    const markdownView = new obsidianMocks.MarkdownView(markdown, dailyFile);
    const leaves = {
      "file-explorer": [{ view: { containerEl: explorer } }],
      markdown: [{
        view: markdownView,
        tabHeaderEl: tab,
        getDisplayText: () => dailyFile.basename,
      }],
    };
    const app = {
      workspace: { getLeavesOfType: (type: keyof typeof leaves) => leaves[type] ?? [] },
      vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
    } as unknown as App;
    const settings = makeSettings();
    const service = {
      invalidate: vi.fn(),
      getDisplayName: () => settings.dailyNoteDates.enabled ? "August 20, 2026" : null,
      getInlineTitle: () => settings.dailyNoteDates.enabled ? "Thu, August 20th, 2026" : null,
    };
    const controller = new DailyNoteDisplayController(app, service as never, () => settings);

    controller.refreshAll();
    expect(explorer.querySelector(".nav-file-title-content")?.textContent).toBe("August 20, 2026");
    expect(markdown.querySelector(".inline-title")?.textContent).toBe("Thu, August 20th, 2026");
    expect(tab.querySelector(".workspace-tab-header-inner-title")?.textContent).toBe("August 20, 2026");
    expect(tab.getAttribute("aria-label")).toBe("August 20, 2026");

    const inlineTitle = markdown.querySelector<HTMLElement>(".inline-title")!;
    inlineTitle.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(inlineTitle.textContent).toBe("2026-08-20");
    controller.refreshAll();
    expect(inlineTitle.textContent).toBe("2026-08-20");

    const explorerRow = explorer.querySelector<HTMLElement>(".nav-file-title")!;
    explorerRow.classList.add("is-being-renamed");
    controller.refreshAll();
    expect(explorer.querySelector(".nav-file-title-content")?.textContent).toBe("2026-08-20");

    settings.dailyNoteDates.enabled = false;
    controller.refreshAll();
    expect(tab.querySelector(".workspace-tab-header-inner-title")?.textContent).toBe("2026-08-20");
    expect(tab.getAttribute("aria-label")).toBe("2026-08-20");
    controller.onunload();
    await Promise.resolve();
  });
});

function makeSettings(): DossierSettings {
  return {
    enabled: true,
    heading: "Linked references",
    showHeading: true,
    showCount: true,
    showSourceHeading: true,
    groupBySource: true,
    showEmpty: false,
    contextMode: "normal",
    contextProfiles: {
      compact: { neighborBlocks: 0, maxChars: 400 },
      normal: { neighborBlocks: 1, maxChars: 900 },
      expanded: { neighborBlocks: 2, maxChars: 1600 },
    },
    sortOrder: "newest",
    parseFilenameDates: true,
    dateFormats: ["YYYY-MM-DD"],
    dateProperty: "date",
    dailyNoteDates: {
      enabled: true,
      folder: "Daily",
      filenameFormat: "YYYY-MM-DD",
      displayFormat: "MMMM D, YYYY",
      titleFormat: "ddd, MMMM Do, YYYY",
    navigator: {
        enabled: true,
        sticky: true,
        weekStart: "monday",
        showMonthHeader: true,
        showTodayIndicator: true,
        showExistingNoteIndicators: false,
        missingNoteBehavior: "daily-notes",
      animation: "subtle",
    },
    timeline: { enabled: true, openOnStartup: false, windowDays: 35 },
      surfaces: { fileExplorer: true, inlineTitle: true, tabTitle: true, backlinks: true },
    },
    initialReferenceLimit: 15,
    includeEmbeds: false,
    openSourceOnExcerptClick: true,
    sourceFolderExclusions: [],
    targetFolderExclusions: [],
    debug: false,
    showAdvancedSettings: false,
    noteOverrides: {},
    collapsedTargets: [],
  };
}
