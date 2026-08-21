import type { ContextPassage } from "../types";

interface CacheEntry {
  sourceMtime: number;
  fingerprint: string;
  passages: ContextPassage[];
}

export class ReferenceCache {
  private readonly entries = new Map<string, CacheEntry>();
  hits = 0;
  misses = 0;

  get(sourcePath: string, targetPath: string, sourceMtime: number, fingerprint: string): ContextPassage[] | undefined {
    const entry = this.entries.get(this.key(sourcePath, targetPath));
    if (entry && entry.sourceMtime === sourceMtime && entry.fingerprint === fingerprint) {
      this.hits += 1;
      return entry.passages;
    }
    this.misses += 1;
    return undefined;
  }

  set(
    sourcePath: string,
    targetPath: string,
    sourceMtime: number,
    fingerprint: string,
    passages: ContextPassage[],
  ): void {
    this.entries.set(this.key(sourcePath, targetPath), { sourceMtime, fingerprint, passages });
  }

  invalidateSource(sourcePath: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${sourcePath}\0`)) this.entries.delete(key);
    }
  }

  invalidateTarget(targetPath: string): void {
    for (const key of this.entries.keys()) {
      if (key.endsWith(`\0${targetPath}`)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private key(sourcePath: string, targetPath: string): string {
    return `${sourcePath}\0${targetPath}`;
  }
}
