import { moment } from "obsidian";
import type {
  ContextMode,
  DailyNoteDateSettings,
  DailyNoteMissingBehavior,
  DailyNoteSwipeAnimation,
  DailyNoteWeekStart,
  DossierSettings,
} from "../types";

export const DEFAULT_SETTINGS: DossierSettings = {
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
  dateFormats: ["YYYY-MM-DD", "YYYY-MM-DD dddd", "YYYY.MM.DD"],
  dateProperty: "date",
  dailyNoteDates: {
    enabled: true,
    folder: "Daily",
    filenameFormat: "YYYY-MM-DD",
    displayFormat: "MMMM D, YYYY",
    titleFormat: "ddd, MMMM Do, YYYY",
    surfaces: {
      fileExplorer: true,
      inlineTitle: true,
      tabTitle: true,
      backlinks: true,
    },
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
    timeline: {
      enabled: true,
      openOnStartup: false,
      windowDays: 35,
    },
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

const MODES: ContextMode[] = ["compact", "normal", "expanded"];

export function normalizeSettings(data: unknown): DossierSettings {
  const raw = isRecord(data) ? data : {};
  const settings: DossierSettings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    contextProfiles: {
      compact: normalizeProfile(raw.contextProfiles, "compact"),
      normal: normalizeProfile(raw.contextProfiles, "normal"),
      expanded: normalizeProfile(raw.contextProfiles, "expanded"),
    },
    dailyNoteDates: normalizeDailyNoteDateSettings(raw.dailyNoteDates),
    dateFormats: normalizeStringArray(raw.dateFormats, DEFAULT_SETTINGS.dateFormats),
    sourceFolderExclusions: normalizePrefixes(raw.sourceFolderExclusions),
    targetFolderExclusions: normalizePrefixes(raw.targetFolderExclusions),
    noteOverrides: normalizeBooleanRecord(raw.noteOverrides),
    collapsedTargets: normalizeStringArray(raw.collapsedTargets, []),
  };

  settings.contextMode = MODES.includes(settings.contextMode) ? settings.contextMode : "normal";
  settings.initialReferenceLimit = clampInteger(settings.initialReferenceLimit, 1, 500, 15);
  settings.heading = typeof settings.heading === "string" ? settings.heading : DEFAULT_SETTINGS.heading;
  settings.dateProperty = typeof settings.dateProperty === "string" ? settings.dateProperty.trim() : "date";
  return settings;
}

function normalizeDailyNoteDateSettings(value: unknown): DailyNoteDateSettings {
  const raw = isRecord(value) ? value : {};
  const rawSurfaces = isRecord(raw.surfaces) ? raw.surfaces : {};
  const rawNavigator = isRecord(raw.navigator) ? raw.navigator : {};
  const rawTimeline = isRecord(raw.timeline) ? raw.timeline : {};
  const fallback = DEFAULT_SETTINGS.dailyNoteDates;
  const weekStart = normalizeWeekStart(rawNavigator.weekStart);
  return {
    enabled: booleanOr(raw.enabled, fallback.enabled),
    folder: normalizeDailyNoteFolder(typeof raw.folder === "string" ? raw.folder : fallback.folder),
    filenameFormat: stringOr(raw.filenameFormat, fallback.filenameFormat),
    displayFormat: stringOr(raw.displayFormat, fallback.displayFormat),
    titleFormat: stringOr(raw.titleFormat, fallback.titleFormat),
    surfaces: {
      fileExplorer: booleanOr(rawSurfaces.fileExplorer, fallback.surfaces.fileExplorer),
      inlineTitle: booleanOr(rawSurfaces.inlineTitle, fallback.surfaces.inlineTitle),
      tabTitle: booleanOr(rawSurfaces.tabTitle, fallback.surfaces.tabTitle),
      backlinks: booleanOr(rawSurfaces.backlinks, fallback.surfaces.backlinks),
    },
    navigator: {
      enabled: booleanOr(rawNavigator.enabled, fallback.navigator.enabled),
      sticky: booleanOr(rawNavigator.sticky, fallback.navigator.sticky),
      weekStart,
      showMonthHeader: booleanOr(rawNavigator.showMonthHeader, fallback.navigator.showMonthHeader),
      showTodayIndicator: booleanOr(
        rawNavigator.showTodayIndicator,
        fallback.navigator.showTodayIndicator,
      ),
      showExistingNoteIndicators: booleanOr(
        rawNavigator.showExistingNoteIndicators,
        fallback.navigator.showExistingNoteIndicators,
      ),
      missingNoteBehavior: normalizeMissingBehavior(rawNavigator.missingNoteBehavior),
      animation: normalizeSwipeAnimation(rawNavigator.animation),
    },
    timeline: {
      enabled: booleanOr(rawTimeline.enabled, fallback.timeline.enabled),
      openOnStartup: booleanOr(rawTimeline.openOnStartup, fallback.timeline.openOnStartup),
      windowDays: clampWindowDays(rawTimeline.windowDays, fallback.timeline.windowDays),
    },
  };
}

function clampWindowDays(value: unknown, fallback: number): number {
  const normalized = clampInteger(value, 21, 63, fallback);
  return normalized - (normalized % 7);
}

function normalizeWeekStart(value: unknown): DailyNoteWeekStart {
  if (value === "sunday" || value === "monday") return value;
  try {
    return moment.localeData().firstDayOfWeek() === 0 ? "sunday" : "monday";
  } catch {
    return "monday";
  }
}

function normalizeMissingBehavior(value: unknown): DailyNoteMissingBehavior {
  return value === "blank" || value === "nothing" || value === "daily-notes"
    ? value
    : "daily-notes";
}

function normalizeSwipeAnimation(value: unknown): DailyNoteSwipeAnimation {
  return value === "none" || value === "subtle" ? value : "subtle";
}

function normalizeProfile(value: unknown, mode: ContextMode) {
  const profiles = isRecord(value) ? value : {};
  const profile = isRecord(profiles[mode]) ? profiles[mode] : {};
  const fallback = DEFAULT_SETTINGS.contextProfiles[mode];
  return {
    neighborBlocks: clampInteger(profile.neighborBlocks, 0, 10, fallback.neighborBlocks),
    maxChars: clampInteger(profile.maxChars, 100, 10000, fallback.maxChars),
  };
}

function normalizePrefixes(value: unknown): string[] {
  return normalizeStringArray(value, [])
    .map((prefix) => prefix.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .filter((prefix, index, all) => all.indexOf(prefix) === index);
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
  );
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function matchesFolderPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function normalizeDailyNoteFolder(folder: string): string {
  return folder
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}
