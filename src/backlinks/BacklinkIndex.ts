import type { MetadataCache } from "obsidian";

export class BacklinkIndex {
  private readonly targetsToSources = new Map<string, Set<string>>();
  private readonly sourcesToTargets = new Map<string, Set<string>>();

  constructor(private readonly metadataCache: Pick<MetadataCache, "resolvedLinks">) {}

  build(): void {
    this.targetsToSources.clear();
    this.sourcesToTargets.clear();
    for (const sourcePath of Object.keys(this.metadataCache.resolvedLinks)) {
      this.updateSource(sourcePath);
    }
  }

  updateSource(sourcePath: string): Set<string> {
    const previousTargets = this.sourcesToTargets.get(sourcePath) ?? new Set<string>();
    const resolved = this.metadataCache.resolvedLinks[sourcePath] ?? {};
    const nextTargets = new Set(Object.keys(resolved).filter((target) => (resolved[target] ?? 0) > 0));

    for (const target of previousTargets) {
      if (!nextTargets.has(target)) this.removeEdge(sourcePath, target);
    }
    for (const target of nextTargets) {
      if (!previousTargets.has(target)) this.addEdge(sourcePath, target);
    }

    if (nextTargets.size > 0) this.sourcesToTargets.set(sourcePath, nextTargets);
    else this.sourcesToTargets.delete(sourcePath);
    return new Set([...previousTargets, ...nextTargets]);
  }

  removeSource(sourcePath: string): Set<string> {
    const targets = this.sourcesToTargets.get(sourcePath) ?? new Set<string>();
    for (const target of targets) this.removeEdge(sourcePath, target);
    this.sourcesToTargets.delete(sourcePath);
    return new Set(targets);
  }

  removeTarget(targetPath: string): Set<string> {
    const sources = this.targetsToSources.get(targetPath) ?? new Set<string>();
    this.targetsToSources.delete(targetPath);
    for (const source of sources) {
      const targets = this.sourcesToTargets.get(source);
      targets?.delete(targetPath);
      if (targets?.size === 0) this.sourcesToTargets.delete(source);
    }
    return new Set(sources);
  }

  renameFile(oldPath: string, newPath: string): Set<string> {
    const affected = new Set<string>();

    const sourceTargets = this.sourcesToTargets.get(oldPath);
    if (sourceTargets) {
      this.sourcesToTargets.delete(oldPath);
      this.sourcesToTargets.set(newPath, new Set(sourceTargets));
      for (const target of sourceTargets) {
        const sources = this.targetsToSources.get(target);
        sources?.delete(oldPath);
        sources?.add(newPath);
        affected.add(target);
      }
    }

    const targetSources = this.targetsToSources.get(oldPath);
    if (targetSources) {
      this.targetsToSources.delete(oldPath);
      const existing = this.targetsToSources.get(newPath) ?? new Set<string>();
      for (const source of targetSources) {
        existing.add(source);
        const targets = this.sourcesToTargets.get(source);
        targets?.delete(oldPath);
        targets?.add(newPath);
      }
      this.targetsToSources.set(newPath, existing);
      affected.add(oldPath);
      affected.add(newPath);
    }
    return affected;
  }

  getSourcesForTarget(targetPath: string): string[] {
    return [...(this.targetsToSources.get(targetPath) ?? [])];
  }

  getTargetsForSource(sourcePath: string): string[] {
    return [...(this.sourcesToTargets.get(sourcePath) ?? [])];
  }

  get edgeCount(): number {
    let count = 0;
    for (const targets of this.sourcesToTargets.values()) count += targets.size;
    return count;
  }

  private addEdge(source: string, target: string): void {
    const sources = this.targetsToSources.get(target) ?? new Set<string>();
    sources.add(source);
    this.targetsToSources.set(target, sources);
  }

  private removeEdge(source: string, target: string): void {
    const sources = this.targetsToSources.get(target);
    if (!sources) return;
    sources.delete(source);
    if (sources.size === 0) this.targetsToSources.delete(target);
  }
}
