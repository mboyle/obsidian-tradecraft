import { beforeAll, describe, expect, it } from "vitest";
import type { DailyNoteDateSettings } from "../src/types";

import {
  DailyNoteDisplayService,
  matchesDailyNoteFolder,
  validateFormats,
} from "../src/dailyDates/DailyNoteDisplayService";
import moment from "moment";

describe("DailyNoteDisplayService", () => {
  beforeAll(() => moment.locale("en"));

  it("strictly formats valid daily note basenames", () => {
    const settings = makeSettings();
    const service = new DailyNoteDisplayService(() => settings);
    expect(service.getDisplayName(file("Daily/2024-02-29.md"))).toBe("February 29, 2024");
    expect(service.getDisplayName(file("Daily/2023-02-29.md"))).toBeNull();
    expect(service.getDisplayName(file("Daily/notes-2024-02-29.md"))).toBeNull();
  });

  it("matches an exact folder and descendants without matching near prefixes", () => {
    expect(matchesDailyNoteFolder("Daily/2026-08-20.md", "Daily")).toBe(true);
    expect(matchesDailyNoteFolder("Daily/Health/2026-08-20.md", "/Daily/")).toBe(true);
    expect(matchesDailyNoteFolder("Daily Notes/2026-08-20.md", "Daily")).toBe(false);
    expect(matchesDailyNoteFolder("2026-08-20.md", "")).toBe(true);
    expect(matchesDailyNoteFolder("Journal/2026-08-20.md", "/")).toBe(true);
  });

  it("supports custom strict Moment formats and automatically invalidates changed settings", () => {
    const settings = makeSettings();
    const service = new DailyNoteDisplayService(() => settings);
    expect(service.getDisplayName(file("Daily/2026-08-20.md"))).toBe("August 20, 2026");
    settings.displayFormat = "YYYY.MM.DD";
    expect(service.getDisplayName(file("Daily/2026-08-20.md"))).toBe("2026.08.20");
    settings.filenameFormat = "YYYY.MM.DD";
    expect(service.getDisplayName(file("Daily/2026.08.20.md"))).toBe("2026.08.20");
  });

  it("falls back to native names for disabled, out-of-scope, and non-Markdown files", () => {
    const settings = makeSettings();
    const service = new DailyNoteDisplayService(() => settings);
    expect(service.getDisplayName(file("Journal/2026-08-20.md"))).toBeNull();
    expect(service.getDisplayName(file("Daily/2026-08-20.canvas"))).toBeNull();
    settings.enabled = false;
    expect(service.getDisplayName(file("Daily/2026-08-20.md"))).toBeNull();
    expect(service.getInlineTitle(file("Daily/2026-08-20.md"))).toBeNull();
    expect(service.getDailyNoteDate(file("Daily/2026-08-20.md"))?.format("YYYY-MM-DD"))
      .toBe("2026-08-20");
  });

  it("uses canonical date parsing and path resolution for navigator lookups", () => {
    const settings = makeSettings();
    const service = new DailyNoteDisplayService(() => settings);
    const daily = file("Daily/2026-08-20.md");
    expect(service.getDailyNoteDate(daily)?.format("YYYY-MM-DD")).toBe("2026-08-20");
    expect(service.getInlineTitle(daily)).toBe("Thu, August 20th, 2026");
    expect(service.dateToDailyFilePath(moment("2028-02-29"))).toBe("Daily/2028-02-29.md");
    settings.folder = "/";
    settings.filenameFormat = "YYYY.MM.DD";
    expect(service.dateToDailyFilePath(moment("2026-12-31"))).toBe("2026.12.31.md");
  });

  it("validates filename formats by strict round-trip and exposes a compact preview", () => {
    const settings = makeSettings();
    const service = new DailyNoteDisplayService(() => settings);
    expect(validateFormats("YYYY-MM-DD", "MMMM D, YYYY")).toBeUndefined();
    expect(validateFormats("YYYY", "MMMM D, YYYY")).toMatch(/year, month, and day/);
    expect(validateFormats("YYYY-MM-DD", "")).toMatch(/display date format/);
    expect(validateFormats("YYYY-MM-DD", "MMMM D, YYYY", "")).toMatch(/inline title/);
    expect(service.getPreview()).toEqual({
      valid: true,
      source: "2000-02-29",
      display: "February 29, 2000",
      title: "Tue, February 29th, 2000",
    });
  });
});

function makeSettings(): DailyNoteDateSettings {
  return {
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
  };
}

function file(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return {
    path,
    basename: dot < 0 ? name : name.slice(0, dot),
    extension: dot < 0 ? "" : name.slice(dot + 1),
  };
}
