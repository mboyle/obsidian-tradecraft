import { moment, type TFile } from "obsidian";
import type { Moment } from "moment";
import type { DailyNoteDateSettings } from "../types";
import { normalizeDailyNoteFolder } from "../settings/Settings";

export type DailyNoteDisplayFile = Pick<TFile, "path" | "basename" | "extension">;

export interface DailyNoteDatePreview {
  valid: boolean;
  source: string;
  display?: string;
  title?: string;
  error?: string;
}

interface CachedDisplayName {
  basename: string;
  fingerprint: string;
  displayName: string | null;
}

const PREVIEW_DATE: [number, number, number] = [2000, 1, 29];

export class DailyNoteDisplayService {
  private readonly cache = new Map<string, CachedDisplayName>();
  private lastFingerprint = "";
  private formatError?: string;

  constructor(private readonly getSettings: () => DailyNoteDateSettings) {}

  getDisplayName(file: DailyNoteDisplayFile): string | null {
    const settings = this.getSettings();
    const fingerprint = settingsFingerprint(settings);
    if (fingerprint !== this.lastFingerprint) {
      this.cache.clear();
      this.lastFingerprint = fingerprint;
      this.formatError = validateFormats(settings.filenameFormat, settings.displayFormat);
    }

    const cached = this.cache.get(file.path);
    if (cached?.basename === file.basename && cached.fingerprint === fingerprint) return cached.displayName;

    const displayName = this.computeDisplayName(file, settings, this.formatError);
    this.cache.set(file.path, { basename: file.basename, fingerprint, displayName });
    return displayName;
  }

  getInlineTitle(file: DailyNoteDisplayFile): string | null {
    const date = this.getDailyNoteDate(file);
    const settings = this.getSettings();
    if (!date || !settings.enabled || !settings.titleFormat.trim()) return null;
    return date.format(settings.titleFormat);
  }

  getDailyNoteDate(file: DailyNoteDisplayFile): Moment | null {
    const settings = this.getSettings();
    if (file.extension.toLowerCase() !== "md" || !matchesDailyNoteFolder(file.path, settings.folder)) {
      return null;
    }
    if (validateFilenameFormat(settings.filenameFormat)) return null;
    const parsed = moment(file.basename, settings.filenameFormat, true);
    return parsed.isValid() ? parsed.startOf("day") : null;
  }

  dateToDailyFilePath(date: Moment): string {
    const settings = this.getSettings();
    const filename = date.clone().format(settings.filenameFormat);
    const folder = normalizeDailyNoteFolder(settings.folder);
    return folder ? `${folder}/${filename}.md` : `${filename}.md`;
  }

  getPreview(): DailyNoteDatePreview {
    const settings = this.getSettings();
    const formatError = validateFormats(settings.filenameFormat, settings.displayFormat, settings.titleFormat);
    const sample = moment(PREVIEW_DATE);
    const source = sample.format(settings.filenameFormat);
    if (formatError) return { valid: false, source, error: formatError };
    return {
      valid: true,
      source,
      display: sample.format(settings.displayFormat),
      title: sample.format(settings.titleFormat),
    };
  }

  isInScope(file: DailyNoteDisplayFile): boolean {
    return file.extension.toLowerCase() === "md" && matchesDailyNoteFolder(file.path, this.getSettings().folder);
  }

  invalidate(path?: string): void {
    if (path) this.cache.delete(path);
    else this.cache.clear();
  }

  private computeDisplayName(
    file: DailyNoteDisplayFile,
    settings: DailyNoteDateSettings,
    formatError: string | undefined,
  ): string | null {
    if (!settings.enabled || file.extension.toLowerCase() !== "md") return null;
    if (!matchesDailyNoteFolder(file.path, settings.folder)) return null;
    if (formatError) return null;
    const parsed = moment(file.basename, settings.filenameFormat, true);
    if (!parsed.isValid()) return null;
    return parsed.format(settings.displayFormat);
  }
}

export function matchesDailyNoteFolder(path: string, configuredFolder: string): boolean {
  const folder = normalizeDailyNoteFolder(configuredFolder);
  if (!folder) return true;
  const slash = path.lastIndexOf("/");
  const parentPath = slash < 0 ? "" : path.slice(0, slash);
  return parentPath === folder || parentPath.startsWith(`${folder}/`);
}

export function validateFormats(
  filenameFormat: string,
  displayFormat: string,
  titleFormat = "ddd, MMMM Do, YYYY",
): string | undefined {
  const filenameError = validateFilenameFormat(filenameFormat);
  if (filenameError) return filenameError;
  if (!displayFormat.trim()) return "Enter a display date format.";
  if (!titleFormat.trim()) return "Enter an inline title date format.";
  return undefined;
}

export function validateFilenameFormat(filenameFormat: string): string | undefined {
  if (!filenameFormat.trim()) return "Enter a filename date format.";
  const sample = moment(PREVIEW_DATE);
  const source = sample.format(filenameFormat);
  const parsed = moment(source, filenameFormat, true);
  if (
    !parsed.isValid()
    || parsed.year() !== PREVIEW_DATE[0]
    || parsed.month() !== PREVIEW_DATE[1]
    || parsed.date() !== PREVIEW_DATE[2]
  ) {
    return "Filename format must strictly encode a valid year, month, and day.";
  }
  return undefined;
}

function settingsFingerprint(settings: DailyNoteDateSettings): string {
  return JSON.stringify([
    settings.enabled,
    normalizeDailyNoteFolder(settings.folder),
    settings.filenameFormat,
    settings.displayFormat,
    settings.titleFormat,
  ]);
}
