import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, TFile, moment, type App } from "obsidian";
import type { DailyNoteDateSettings } from "../src/types";
import { DailyNoteDisplayService } from "../src/dailyDates/DailyNoteDisplayService";
import { DailyNoteFileResolver } from "../src/dailyDates/DailyNoteFileResolver";

describe("DailyNoteFileResolver", () => {
  beforeEach(() => {
    noticeMessages().length = 0;
  });

  it("returns an existing canonical note using a direct path lookup", async () => {
    const existing = makeTFile("Daily/2026-08-20.md");
    const harness = makeHarness([[existing.path, existing]]);
    const result = await harness.resolver.resolve(moment("2026-08-20"), "daily-notes");
    expect(result).toBe(existing);
    expect(harness.vault.getFileByPath).toHaveBeenCalledWith(existing.path);
    expect(harness.vault.create).not.toHaveBeenCalled();
  });

  it("does nothing for a missing note when configured", async () => {
    const harness = makeHarness();
    expect(await harness.resolver.resolve(moment("2026-08-21"), "nothing")).toBeNull();
    expect(harness.vault.create).not.toHaveBeenCalled();
  });

  it("creates missing parent folders and a canonical note with a starter bullet", async () => {
    const settings = makeSettings();
    settings.folder = "Journal/Daily";
    const harness = makeHarness([], settings);
    const created = await harness.resolver.resolve(moment("2026-08-21"), "blank");
    expect(harness.vault.createFolder.mock.calls.map((call) => call[0])).toEqual([
      "Journal", "Journal/Daily",
    ]);
    expect(harness.vault.create).toHaveBeenCalledWith("Journal/Daily/2026-08-21.md", "- ");
    expect(created?.path).toBe("Journal/Daily/2026-08-21.md");
  });

  it("uses the enabled Daily Notes bridge only when folder and format match", async () => {
    const templated = makeTFile("Daily/2026-08-22.md");
    const getDailyNote = vi.fn().mockResolvedValue(templated);
    const harness = makeHarness();
    harness.contents.set(templated.path, "Template content\n");
    harness.app.internalPlugins = {
      getEnabledPluginById: () => ({
        options: { folder: "Daily" },
        getFormat: () => "YYYY-MM-DD",
        getDailyNote,
      }),
    };
    expect(await harness.resolver.resolve(moment("2026-08-22"), "daily-notes")).toBe(templated);
    expect(getDailyNote).toHaveBeenCalledOnce();
    expect(harness.vault.create).not.toHaveBeenCalled();
    expect(harness.vault.modify).not.toHaveBeenCalled();

    const mismatch = makeHarness();
    mismatch.app.internalPlugins = {
      getEnabledPluginById: () => ({
        options: { folder: "Elsewhere" },
        getFormat: () => "YYYY-MM-DD",
        getDailyNote: vi.fn(),
      }),
    };
    expect((await mismatch.resolver.resolve(moment("2026-08-22"), "daily-notes"))?.path)
      .toBe("Daily/2026-08-22.md");
    expect(mismatch.vault.create).toHaveBeenCalledOnce();
  });

  it("adds a starter bullet when Daily Notes creates a genuinely empty note", async () => {
    const created = makeTFile("Daily/2026-08-22.md");
    const harness = makeHarness();
    harness.contents.set(created.path, "");
    harness.app.internalPlugins = {
      getEnabledPluginById: () => ({
        options: { folder: "Daily" },
        getFormat: () => "YYYY-MM-DD",
        getDailyNote: vi.fn().mockResolvedValue(created),
      }),
    };

    expect(await harness.resolver.resolve(moment("2026-08-22"), "daily-notes")).toBe(created);
    expect(harness.vault.modify).toHaveBeenCalledWith(created, "- ");
    expect(harness.contents.get(created.path)).toBe("- ");
  });

  it("re-queries after concurrent creation and reports unrecoverable conflicts", async () => {
    const race = makeHarness();
    const racedFile = makeTFile("Daily/2026-08-23.md");
    race.vault.create.mockImplementationOnce(async () => {
      race.files.set(racedFile.path, racedFile);
      throw new Error("already exists");
    });
    expect(await race.resolver.resolve(moment("2026-08-23"), "blank")).toBe(racedFile);

    const conflict = makeHarness();
    conflict.vault.getAbstractFileByPath.mockImplementation((path: string) => (
      path === "Daily" ? { path, type: "file" } : null
    ));
    expect(await conflict.resolver.resolve(moment("2026-08-24"), "blank")).toBeNull();
    expect(noticeMessages().at(-1)).toContain("Daily/2026-08-24.md");
  });
});

function makeHarness(
  initial: Array<[string, TFile]> = [],
  settings = makeSettings(),
) {
  const files = new Map(initial);
  const contents = new Map<string, string>();
  const folders = new Set<string>();
  const vault = {
    getFileByPath: vi.fn((path: string) => files.get(path) ?? null),
    getFolderByPath: vi.fn((path: string) => folders.has(path) ? { path } : null),
    getAbstractFileByPath: vi.fn((path: string): { path: string; type: string } | null => {
      void path;
      return null;
    }),
    createFolder: vi.fn(async (path: string) => {
      folders.add(path);
      return { path };
    }),
    create: vi.fn(async (path: string, content: string) => {
      const file = makeTFile(path);
      files.set(path, file);
      contents.set(path, content);
      return file;
    }),
    cachedRead: vi.fn(async (file: TFile) => contents.get(file.path) ?? ""),
    modify: vi.fn(async (file: TFile, content: string) => {
      contents.set(file.path, content);
    }),
  };
  const app = { vault } as unknown as App & {
    internalPlugins?: { getEnabledPluginById: (id: string) => unknown };
  };
  const service = new DailyNoteDisplayService(() => settings);
  return {
    app,
    files,
    contents,
    vault,
    resolver: new DailyNoteFileResolver(app, service, () => settings),
  };
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

function noticeMessages(): string[] {
  return (Notice as unknown as { messages: string[] }).messages;
}

function makeSettings(): DailyNoteDateSettings {
  return {
    enabled: true,
    folder: "Daily",
    filenameFormat: "YYYY-MM-DD",
    displayFormat: "MMMM D, YYYY",
    titleFormat: "ddd, MMMM Do, YYYY",
    surfaces: { fileExplorer: true, inlineTitle: true, tabTitle: true, backlinks: true },
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
  };
}
