import { TFile, type App, type CachedMetadata } from "obsidian";
import type {
  ContextPassage,
  DossierSettings,
  ReferenceSnapshot,
  ResolvedReference,
  SourceBacklinkGroup,
  SourceDocument,
} from "../types";
import { formatDisplayDate, parseDateValue, parseFilenameDate } from "../utils/dates";
import { matchesFolderPrefix } from "../settings/Settings";
import type { DailyNoteDisplayService } from "../dailyDates/DailyNoteDisplayService";
import { BacklinkIndex } from "./BacklinkIndex";
import { ContextExtractor } from "./ContextExtractor";
import { ReferenceCache } from "./ReferenceCache";
import { ReferenceResolver } from "./ReferenceResolver";

type Subscriber = () => void;

interface GroupShell extends Omit<SourceBacklinkGroup, "passages"> {
  passages?: ContextPassage[];
}

export class BacklinkService {
  readonly index: BacklinkIndex;
  readonly referenceCache = new ReferenceCache();
  private readonly resolver: ReferenceResolver;
  private readonly extractor = new ContextExtractor();
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => DossierSettings,
    private readonly dailyNoteDisplay: DailyNoteDisplayService,
  ) {
    this.index = new BacklinkIndex(app.metadataCache);
    this.resolver = new ReferenceResolver(app.metadataCache);
  }

  buildIndex(): void {
    const started = performance.now();
    this.index.build();
    this.debug(`Index built with ${this.index.edgeCount} edges in ${(performance.now() - started).toFixed(1)}ms`);
  }

  shouldRender(targetFile: TFile): boolean {
    const settings = this.getSettings();
    if (matchesFolderPrefix(targetFile.path, settings.targetFolderExclusions)) return false;
    const frontmatter: unknown = this.app.metadataCache.getFileCache(targetFile)?.frontmatter;
    const frontmatterOverride = recordValue(frontmatter, "contextual-backlinks");
    if (typeof frontmatterOverride === "boolean") return frontmatterOverride;
    const noteOverride = settings.noteOverrides[targetFile.path];
    if (typeof noteOverride === "boolean") return noteOverride;
    return settings.enabled;
  }

  async getSnapshot(targetFile: TFile, showAll = false, hydrate = true): Promise<ReferenceSnapshot> {
    if (!this.shouldRender(targetFile)) return { targetFile, groups: [], totalOccurrences: 0 };
    const settings = this.getSettings();
    const shells = this.getGroupShells(targetFile);
    const totalOccurrences = shells.reduce((total, group) => total + group.occurrences.length, 0);
    if (totalOccurrences === 0) return { targetFile, groups: [], totalOccurrences: 0 };

    const visibleShells = showAll ? shells : takeOccurrenceBudget(shells, settings.initialReferenceLimit);
    if (!hydrate) {
      return {
        targetFile,
        groups: visibleShells.map((shell) => ({ ...shell, passages: [] })),
        totalOccurrences,
      };
    }
    const hydrated = await mapWithConcurrency(visibleShells, 8, async (shell) => ({
      ...shell,
      passages: await this.getPassages(shell.sourceFile, targetFile, shell.occurrences),
    }));
    return { targetFile, groups: hydrated, totalOccurrences };
  }

  subscribe(targetPath: string, callback: Subscriber): () => void {
    const callbacks = this.subscribers.get(targetPath) ?? new Set<Subscriber>();
    callbacks.add(callback);
    this.subscribers.set(targetPath, callbacks);
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) this.subscribers.delete(targetPath);
    };
  }

  notifyTarget(targetPath: string): void {
    for (const callback of this.subscribers.get(targetPath) ?? []) callback();
  }

  notifyAll(): void {
    for (const callbacks of this.subscribers.values()) {
      for (const callback of callbacks) callback();
    }
  }

  invalidateSource(sourcePath: string): void {
    this.referenceCache.invalidateSource(sourcePath);
  }

  invalidateTarget(targetPath: string): void {
    this.referenceCache.invalidateTarget(targetPath);
    this.notifyTarget(targetPath);
  }

  clearCache(): void {
    this.referenceCache.clear();
    this.notifyAll();
  }

  private getGroupShells(targetFile: TFile): GroupShell[] {
    const settings = this.getSettings();
    const groups: GroupShell[] = [];
    for (const sourcePath of this.index.getSourcesForTarget(targetFile.path)) {
      if (matchesFolderPrefix(sourcePath, settings.sourceFolderExclusions)) continue;
      const source = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(source instanceof TFile) || source.extension !== "md") continue;
      const cache = this.app.metadataCache.getFileCache(source);
      const occurrences = this.resolver.resolve(source.path, targetFile.path, cache, settings.includeEmbeds);
      if (occurrences.length === 0) continue;
      groups.push(this.makeShell(source, cache, occurrences));
    }
    return sortGroups(groups, settings.sortOrder);
  }

  private makeShell(sourceFile: TFile, cache: CachedMetadata | null, occurrences: ResolvedReference[]): GroupShell {
    const settings = this.getSettings();
    const frontmatter: unknown = cache?.frontmatter;
    const frontmatterTitle = recordValue(frontmatter, "title");
    const sourceTitle = typeof frontmatterTitle === "string" && frontmatterTitle.trim()
      ? frontmatterTitle.trim()
      : sourceFile.basename;
    const filenameDate = settings.parseFilenameDates
      ? parseFilenameDate(sourceFile.basename, settings.dateFormats)
      : undefined;
    const propertyDate = settings.dateProperty
      ? parseDateValue(cache?.frontmatter?.[settings.dateProperty])
      : undefined;
    const sourceDate = filenameDate?.timestamp ?? propertyDate?.timestamp ?? sourceFile.stat.ctime ?? sourceFile.stat.mtime;
    const dailyNoteLabel = settings.dailyNoteDates.surfaces.backlinks
      ? this.dailyNoteDisplay.getDisplayName(sourceFile)
      : null;
    const isDailyNote = this.dailyNoteDisplay.isInScope(sourceFile);
    const sourceLabel = chooseSourceLabel(
      frontmatterTitle,
      dailyNoteLabel,
      isDailyNote,
      filenameDate ? formatDisplayDate(filenameDate.date) : undefined,
      sourceFile.basename,
    );
    const folder = sourceFile.parent?.isRoot() ? undefined : sourceFile.parent?.path;
    return {
      sourceFile,
      sourceTitle,
      sourceLabel,
      sourceFolder: folder,
      sourceDate,
      occurrences,
    };
  }

  private async getPassages(
    sourceFile: TFile,
    targetFile: TFile,
    occurrences: ResolvedReference[],
  ): Promise<ContextPassage[]> {
    const settings = this.getSettings();
    const profile = settings.contextProfiles[settings.contextMode];
    const fingerprint = JSON.stringify({
      profile,
      mode: settings.contextMode,
      embeds: settings.includeEmbeds,
      references: occurrences.map((occurrence) => [occurrence.startOffset, occurrence.endOffset]),
    });
    const cached = this.referenceCache.get(sourceFile.path, targetFile.path, sourceFile.stat.mtime, fingerprint);
    if (cached) return cached;

    const started = performance.now();
    const markdown = await this.app.vault.cachedRead(sourceFile);
    const metadata = this.app.metadataCache.getFileCache(sourceFile);
    const document: SourceDocument = {
      markdown,
      sections: metadata?.sections ?? [],
      headings: metadata?.headings ?? [],
      listItems: metadata?.listItems ?? [],
    };
    const extracted = this.extractor.extract(document, occurrences, profile);
    const passages = extracted.map((context, index): ContextPassage => ({
      ...context,
      key: `${sourceFile.path}:${context.startOffset}:${index}`,
      sourcePath: sourceFile.path,
      targetPath: targetFile.path,
      occurrences: context.references,
      primaryOccurrence: context.references[0]!,
    }));
    this.referenceCache.set(sourceFile.path, targetFile.path, sourceFile.stat.mtime, fingerprint, passages);
    this.debug(
      `Extracted ${occurrences.length} occurrence(s) from ${sourceFile.path} in ${(performance.now() - started).toFixed(1)}ms`,
    );
    return passages;
  }

  private debug(message: string): void {
    if (this.getSettings().debug) console.debug(`[Tradecraft] ${message}`);
  }
}

function recordValue(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

export function chooseSourceLabel(
  frontmatterTitle: unknown,
  dailyNoteLabel: string | null,
  isDailyNote: boolean,
  legacyFilenameLabel: string | undefined,
  basename: string,
): string {
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim()) return frontmatterTitle.trim();
  if (dailyNoteLabel) return dailyNoteLabel;
  if (!isDailyNote && legacyFilenameLabel) return legacyFilenameLabel;
  return basename;
}

function takeOccurrenceBudget(groups: GroupShell[], limit: number): GroupShell[] {
  const selected: GroupShell[] = [];
  let count = 0;
  for (const group of groups) {
    if (count >= limit) break;
    const remaining = limit - count;
    const occurrences = group.occurrences.slice(0, remaining);
    selected.push({ ...group, occurrences });
    count += occurrences.length;
  }
  return selected;
}

function sortGroups(groups: GroupShell[], order: DossierSettings["sortOrder"]): GroupShell[] {
  return [...groups].sort((a, b) => {
    if (order === "source") return compareText(a.sourceTitle, b.sourceTitle) || compareText(a.sourceFile.path, b.sourceFile.path);
    const direction = order === "newest" ? -1 : 1;
    const dateDifference = ((a.sourceDate ?? 0) - (b.sourceDate ?? 0)) * direction;
    return dateDifference || compareText(a.sourceTitle, b.sourceTitle) || compareText(a.sourceFile.path, b.sourceFile.path);
  });
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
