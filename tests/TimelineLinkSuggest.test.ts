// @vitest-environment jsdom

import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import {
  timelineWikiLinkCompletions,
  timelineWikiLinkExtensions,
  timelineWikiLinkMatch,
  timelineWikiLinkPairInsertion,
  timelineTagCompletions,
} from "../src/dailyDates/TimelineLinkSuggest";

describe("timeline wiki-link suggestions", () => {
  it("recognizes unfinished wiki links on the active line", () => {
    expect(timelineWikiLinkMatch("- [[Books", 9)).toEqual({ from: 4, query: "Books" });
    expect(timelineWikiLinkMatch("- ordinary text", 15)).toBeNull();
    expect(timelineWikiLinkMatch("- [[closed]]", 12)).toBeNull();
  });

  it("uses Obsidian's configured link generator and folder details for suggestions", () => {
    const file = {
      basename: "Books to read",
      path: "Leisure/Books to read.md",
      extension: "md",
      parent: { path: "Leisure" },
    } as TFile;
    const app = {
      vault: { getFiles: vi.fn(() => [file]) },
      metadataCache: { getFileCache: vi.fn(() => null) },
      fileManager: { generateMarkdownLink: vi.fn(() => "[[Leisure/Books to read]]") },
    } as unknown as App;

    const completions = timelineWikiLinkCompletions(app, "Daily/2026-08-23.md");
    expect(completions[0]).toMatchObject({
      label: "Books to read",
      detail: "Leisure/",
    });
  });

  it("pairs the second opening bracket and leaves the caret inside", () => {
    expect(timelineWikiLinkPairInsertion("[", 1, 1, "[", "")).toEqual({
      insert: "[]]",
      anchor: 2,
    });
    expect(timelineWikiLinkPairInsertion("[", 1, 1, "[", "]]" )).toBeNull();
  });

  it("includes frontmatter aliases and vault tags", () => {
    const file = {
      basename: "Product strategy",
      path: "Product strategy.md",
      extension: "md",
      parent: { path: "/" },
    } as TFile;
    const app = {
      vault: {
        getFiles: vi.fn(() => [file]),
        getMarkdownFiles: vi.fn(() => [file]),
      },
      metadataCache: {
        getFileCache: vi.fn(() => ({
          frontmatter: { aliases: ["Roadmap"] },
          tags: [{ tag: "#launch" }, { tag: "#product/roadmap" }],
        })),
      },
      fileManager: { generateMarkdownLink: vi.fn(() => "[[Product strategy]]") },
    } as unknown as App;

    expect(timelineWikiLinkCompletions(app, "Daily/today.md").map(({ label }) => label)).toEqual([
      "Product strategy",
      "Roadmap",
    ]);
    expect(timelineTagCompletions(app).map(({ label }) => label)).toEqual([
      "launch",
      "product/roadmap",
    ]);
  });

  it("opens the note picker after a typed wiki-link trigger", async () => {
    const file = {
      basename: "Books to read",
      path: "Leisure/Books to read.md",
      extension: "md",
      parent: { path: "Leisure" },
    } as TFile;
    const app = {
      vault: {
        getFiles: vi.fn(() => [file]),
        getMarkdownFiles: vi.fn(() => [file]),
      },
      metadataCache: { getFileCache: vi.fn(() => null) },
      fileManager: { generateMarkdownLink: vi.fn(() => "[[Books to read]]") },
    } as unknown as App;
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "[",
        selection: { anchor: 1 },
        extensions: timelineWikiLinkExtensions(app, "Daily/2026-08-23.md"),
      }),
    });

    view.dispatch({
      changes: { from: 1, insert: "[" },
      selection: { anchor: 2 },
      annotations: Transaction.userEvent.of("input.type"),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(host.querySelector(".cm-tooltip-autocomplete")?.textContent).toContain("Books to read");
    view.destroy();
    host.remove();
  });

  it("offers and applies slash commands", async () => {
    const app = {} as App;
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "- ",
        selection: { anchor: 2 },
        extensions: timelineWikiLinkExtensions(app, "Daily/2026-08-23.md"),
      }),
    });
    view.dispatch({
      changes: { from: 2, insert: "/" },
      selection: { anchor: 3 },
      annotations: Transaction.userEvent.of("input.type"),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(host.querySelector(".cm-tooltip-autocomplete")?.textContent).toContain("Bullet list");
    view.destroy();
    host.remove();
  });
});
