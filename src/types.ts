import type { HeadingCache, ListItemCache, SectionCache, TFile } from "obsidian";

export type ContextMode = "compact" | "normal" | "expanded";
export type SortOrder = "newest" | "oldest" | "source";
export type DailyNoteDateSurface = "fileExplorer" | "inlineTitle" | "tabTitle" | "backlinks";
export type DailyNoteWeekStart = "sunday" | "monday";
export type DailyNoteMissingBehavior = "daily-notes" | "blank" | "nothing";
export type DailyNoteSwipeAnimation = "subtle" | "none";

export interface DailyNoteDateSurfaces {
  fileExplorer: boolean;
  inlineTitle: boolean;
  tabTitle: boolean;
  backlinks: boolean;
}

export interface DailyNoteNavigatorSettings {
  enabled: boolean;
  sticky: boolean;
  weekStart: DailyNoteWeekStart;
  showMonthHeader: boolean;
  showTodayIndicator: boolean;
  showExistingNoteIndicators: boolean;
  missingNoteBehavior: DailyNoteMissingBehavior;
  animation: DailyNoteSwipeAnimation;
}

export interface DailyNoteTimelineSettings {
  enabled: boolean;
  openOnStartup: boolean;
  windowDays: number;
}

export interface DailyNoteDateSettings {
  enabled: boolean;
  folder: string;
  filenameFormat: string;
  displayFormat: string;
  titleFormat: string;
  surfaces: DailyNoteDateSurfaces;
  navigator: DailyNoteNavigatorSettings;
  timeline: DailyNoteTimelineSettings;
}

export interface ContextProfile {
  neighborBlocks: number;
  maxChars: number;
}

export interface DossierSettings {
  enabled: boolean;
  heading: string;
  showHeading: boolean;
  showCount: boolean;
  showSourceHeading: boolean;
  groupBySource: boolean;
  showEmpty: boolean;
  contextMode: ContextMode;
  contextProfiles: Record<ContextMode, ContextProfile>;
  sortOrder: SortOrder;
  parseFilenameDates: boolean;
  dateFormats: string[];
  dateProperty: string;
  dailyNoteDates: DailyNoteDateSettings;
  initialReferenceLimit: number;
  includeEmbeds: boolean;
  openSourceOnExcerptClick: boolean;
  sourceFolderExclusions: string[];
  targetFolderExclusions: string[];
  debug: boolean;
  showAdvancedSettings: boolean;
  noteOverrides: Record<string, boolean>;
  collapsedTargets: string[];
}

export interface SourceRange {
  start: number;
  end: number;
}

export interface ResolvedReference {
  targetPath: string;
  sourcePath: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  original: string;
  displayText?: string;
  linkText: string;
  isEmbed: boolean;
  occurrenceIndex: number;
}

export interface ExtractedContext {
  markdown: string;
  fullMarkdown: string;
  startOffset: number;
  endOffset: number;
  linkOffsetsWithinExcerpt: SourceRange[];
  truncated: boolean;
  heading?: string;
}

export interface BacklinkOccurrence extends ResolvedReference, ExtractedContext {
  sourceTitle: string;
  sourceDate?: number;
}

export interface ContextPassage extends ExtractedContext {
  key: string;
  sourcePath: string;
  targetPath: string;
  occurrences: ResolvedReference[];
  primaryOccurrence: ResolvedReference;
}

export interface SourceBacklinkGroup {
  sourceFile: TFile;
  sourceTitle: string;
  sourceLabel: string;
  sourceFolder?: string;
  sourceDate?: number;
  passages: ContextPassage[];
  occurrences: ResolvedReference[];
}

export interface SourceDocument {
  markdown: string;
  sections: SectionCache[];
  headings: HeadingCache[];
  listItems: ListItemCache[];
}

export interface ReferenceSnapshot {
  targetFile: TFile;
  groups: SourceBacklinkGroup[];
  totalOccurrences: number;
}

export interface RenderOptions {
  forceExpanded: boolean;
  showAll: boolean;
}
