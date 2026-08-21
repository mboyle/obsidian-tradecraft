import { getLinkpath, type CachedMetadata, type MetadataCache } from "obsidian";
import type { ResolvedReference } from "../types";

export class ReferenceResolver {
  constructor(private readonly metadataCache: Pick<MetadataCache, "getFirstLinkpathDest">) {}

  resolve(
    sourcePath: string,
    targetPath: string,
    cache: CachedMetadata | null,
    includeEmbeds: boolean,
  ): ResolvedReference[] {
    if (!cache) return [];
    const candidates = [
      ...(cache.links ?? []).map((reference) => ({ reference, isEmbed: false })),
      ...(includeEmbeds ? (cache.embeds ?? []).map((reference) => ({ reference, isEmbed: true })) : []),
    ];
    let occurrenceIndex = 0;
    const matches: ResolvedReference[] = [];

    for (const { reference, isEmbed } of candidates) {
      const destination = this.metadataCache.getFirstLinkpathDest(getLinkpath(reference.link), sourcePath);
      if (destination?.path !== targetPath) continue;
      matches.push({
        targetPath,
        sourcePath,
        startOffset: reference.position.start.offset,
        endOffset: reference.position.end.offset,
        startLine: reference.position.start.line,
        startColumn: reference.position.start.col,
        endLine: reference.position.end.line,
        endColumn: reference.position.end.col,
        original: reference.original,
        displayText: reference.displayText,
        linkText: reference.link,
        isEmbed,
        occurrenceIndex,
      });
      occurrenceIndex += 1;
    }

    return matches.sort((a, b) => a.startOffset - b.startOffset);
  }
}
