import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, matchesFolderPrefix, normalizeSettings } from "../src/settings/Settings";
import { formatDisplayDate, parseDateValue, parseFilenameDate } from "../src/utils/dates";
import { chooseSourceLabel } from "../src/backlinks/BacklinkService";

describe("settings", () => {
  it("fills defaults and validates persisted values", () => {
    const settings = normalizeSettings({
      contextMode: "invalid",
      initialReferenceLimit: 9999,
      sourceFolderExclusions: ["/Archive/", "Archive", ""],
      contextProfiles: { normal: { neighborBlocks: -2, maxChars: 20 } },
    });
    expect(settings.contextMode).toBe("normal");
    expect(settings.initialReferenceLimit).toBe(500);
    expect(settings.sourceFolderExclusions).toEqual(["Archive"]);
    expect(settings.contextProfiles.normal).toEqual({ neighborBlocks: 0, maxChars: 100 });
    expect(settings.contextProfiles.compact).toEqual(DEFAULT_SETTINGS.contextProfiles.compact);
    expect(settings.dailyNoteDates).toEqual({
      ...DEFAULT_SETTINGS.dailyNoteDates,
      navigator: { ...DEFAULT_SETTINGS.dailyNoteDates.navigator, weekStart: "sunday" },
    });
  });

  it("deeply migrates partial daily note display settings", () => {
    const settings = normalizeSettings({
      dailyNoteDates: {
        folder: "/Journal//Daily/",
        surfaces: { tabTitle: false },
      },
    });
    expect(settings.dailyNoteDates.folder).toBe("Journal/Daily");
    expect(settings.dailyNoteDates.surfaces).toEqual({
      fileExplorer: true,
      inlineTitle: true,
      tabTitle: false,
      backlinks: true,
    });
    expect(settings.dailyNoteDates.navigator).toEqual({
      enabled: true,
      sticky: true,
      weekStart: "sunday",
      showMonthHeader: true,
      showTodayIndicator: true,
      showExistingNoteIndicators: false,
      missingNoteBehavior: "daily-notes",
      animation: "subtle",
    });
    expect(settings.dailyNoteDates.timeline).toEqual({
      enabled: true,
      openOnStartup: false,
      windowDays: 35,
    });
    expect(settings.dailyNoteDates.titleFormat).toBe("ddd, MMMM Do, YYYY");
  });

  it("deeply migrates and bounds desktop timeline settings", () => {
    expect(normalizeSettings({
      dailyNoteDates: { timeline: { enabled: false, openOnStartup: true, windowDays: 54 } },
    }).dailyNoteDates.timeline).toEqual({
      enabled: false,
      openOnStartup: true,
      windowDays: 49,
    });
    expect(normalizeSettings({
      dailyNoteDates: { timeline: { windowDays: 2 } },
    }).dailyNoteDates.timeline.windowDays).toBe(21);
  });

  it("deeply normalizes persisted navigator values without changing readable-date state", () => {
    const settings = normalizeSettings({
      dailyNoteDates: {
        enabled: false,
        navigator: {
          enabled: true,
          sticky: false,
          weekStart: "monday",
          showMonthHeader: false,
          missingNoteBehavior: "nothing",
          animation: "none",
        },
      },
    });
    expect(settings.dailyNoteDates.enabled).toBe(false);
    expect(settings.dailyNoteDates.navigator).toMatchObject({
      enabled: true,
      sticky: false,
      weekStart: "monday",
      showMonthHeader: false,
      missingNoteBehavior: "nothing",
      animation: "none",
    });
  });

  it("matches exact folders and descendants but not similarly named folders", () => {
    expect(matchesFolderPrefix("Archive/Old.md", ["Archive"])).toBe(true);
    expect(matchesFolderPrefix("Archive", ["Archive"])).toBe(true);
    expect(matchesFolderPrefix("Archives/Old.md", ["Archive"])).toBe(false);
  });
});

describe("dates", () => {
  it.each([
    ["2026-08-18", "YYYY-MM-DD"],
    ["2026-08-18 Wednesday", "YYYY-MM-DD dddd"],
    ["2026.08.18", "YYYY.MM.DD"],
  ])("parses %s using %s", (basename, format) => {
    expect(parseFilenameDate(basename, [format])?.date.getFullYear()).toBe(2026);
  });

  it("strictly rejects invalid dates and unmatched names", () => {
    expect(parseFilenameDate("2026-02-31", ["YYYY-MM-DD"])).toBeUndefined();
    expect(parseFilenameDate("notes 2026-08-18", ["YYYY-MM-DD"])).toBeUndefined();
  });

  it("parses date properties and formats a readable value", () => {
    const parsed = parseDateValue("2026-08-18T12:00:00Z");
    expect(parsed).toBeDefined();
    expect(formatDisplayDate(parsed!.date)).toMatch(/2026/);
  });
});

describe("backlink source labels", () => {
  it("keeps frontmatter first and prevents legacy formatting from bypassing the Daily toggle", () => {
    expect(chooseSourceLabel("Custom title", "August 20, 2026", true, "Legacy date", "2026-08-20"))
      .toBe("Custom title");
    expect(chooseSourceLabel(undefined, "August 20, 2026", true, "Legacy date", "2026-08-20"))
      .toBe("August 20, 2026");
    expect(chooseSourceLabel(undefined, null, true, "Legacy date", "2026-08-20"))
      .toBe("2026-08-20");
    expect(chooseSourceLabel(undefined, null, false, "Legacy date", "2026-08-20"))
      .toBe("Legacy date");
  });
});
