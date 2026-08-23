import { Notice, TFile, moment, type App } from "obsidian";
import type { Moment } from "moment";
import type { DailyNoteDateSettings, DailyNoteMissingBehavior } from "../types";
import { normalizeDailyNoteFolder } from "../settings/Settings";
import type { DailyNoteDisplayService } from "./DailyNoteDisplayService";

interface CoreDailyNotesPlugin {
  options?: { folder?: unknown };
  getFormat?: () => unknown;
  getDailyNote?: (date?: Moment) => Promise<TFile | null | undefined>;
}

interface InternalPluginRegistry {
  getEnabledPluginById?: (id: string) => unknown;
}

type AppWithInternalPlugins = App & { internalPlugins?: InternalPluginRegistry };
const DAILY_NOTE_STARTER = "- ";

export class DailyNoteFileResolver {
  constructor(
    private readonly app: App,
    private readonly service: DailyNoteDisplayService,
    private readonly getSettings: () => DailyNoteDateSettings,
  ) {}

  async resolve(date: Moment, behavior: DailyNoteMissingBehavior): Promise<TFile | null> {
    const path = this.service.dateToDailyFilePath(date);
    const existing = this.app.vault.getFileByPath(path);
    if (existing) return existing;
    if (behavior === "nothing") return null;

    if (behavior === "daily-notes") {
      const result = await this.createWithDailyNotes(date);
      if (result.available) {
        if (!result.file) new Notice("Daily Notes could not create this note.");
        return result.file;
      }
    }

    return this.createBlank(path);
  }

  private async createWithDailyNotes(date: Moment): Promise<{ available: boolean; file: TFile | null }> {
    const registry = (this.app as AppWithInternalPlugins).internalPlugins;
    const candidate = registry?.getEnabledPluginById?.("daily-notes");
    if (!isCoreDailyNotesPlugin(candidate)) return { available: false, file: null };

    const settings = this.getSettings();
    const coreFolder = normalizeDailyNoteFolder(
      typeof candidate.options?.folder === "string" ? candidate.options.folder : "",
    );
    const coreFormat = candidate.getFormat?.();
    if (
      coreFolder !== normalizeDailyNoteFolder(settings.folder)
      || coreFormat !== settings.filenameFormat
    ) {
      return { available: false, file: null };
    }

    try {
      const createDailyNote = candidate.getDailyNote;
      if (!createDailyNote) return { available: false, file: null };
      const file = await createDailyNote.call(candidate, date.clone());
      const expectedPath = this.service.dateToDailyFilePath(date);
      const expectedFile = file instanceof TFile && file.path === expectedPath ? file : null;
      if (expectedFile) await this.addStarterToEmptyNote(expectedFile);
      return {
        available: true,
        file: expectedFile,
      };
    } catch (error) {
      console.error("Tradecraft: Daily Notes creation failed", error);
      return { available: true, file: null };
    }
  }

  private async createBlank(path: string): Promise<TFile | null> {
    try {
      await this.ensureParentFolder(path);
      const raced = this.app.vault.getFileByPath(path);
      if (raced) return raced;
      return await this.app.vault.create(path, DAILY_NOTE_STARTER);
    } catch (error) {
      const raced = this.app.vault.getFileByPath(path);
      if (raced) return raced;
      console.error("Tradecraft: blank Daily Note creation failed", error);
      new Notice(`Could not create Daily Note: ${path}`);
      return null;
    }
  }

  private async addStarterToEmptyNote(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.cachedRead(file);
      if (content.length === 0) await this.app.vault.modify(file, DAILY_NOTE_STARTER);
    } catch (error) {
      // Note creation succeeded; a failed convenience stub must not block navigation.
      console.debug("Tradecraft: could not add the Daily Note starter bullet", error);
    }
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const slash = path.lastIndexOf("/");
    if (slash < 0) return;
    const parts = path.slice(0, slash).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (this.app.vault.getFolderByPath(current)) continue;
      if (this.app.vault.getAbstractFileByPath(current)) {
        throw new Error(`A file already exists at ${current}`);
      }
      try {
        await this.app.vault.createFolder(current);
      } catch (error) {
        if (!this.app.vault.getFolderByPath(current)) throw error;
      }
    }
  }
}

function isCoreDailyNotesPlugin(value: unknown): value is CoreDailyNotesPlugin {
  if (typeof value !== "object" || value === null) return false;
  const plugin = value as CoreDailyNotesPlugin;
  return typeof plugin.getDailyNote === "function" && typeof plugin.getFormat === "function";
}

export function todayAtStartOfDay(): Moment {
  return moment().startOf("day");
}
