import { MarkdownView, TFile, type Workspace } from "obsidian";
import type { BacklinksRenderer } from "./BacklinksRenderer";

/**
 * Mobile Obsidian reuses a MarkdownView and its DOM when opening another file.
 * Rebind any surviving Tradecraft renderer to the file that now owns that DOM.
 */
export function reconcileRendererTargets(
  renderers: Iterable<BacklinksRenderer>,
  workspace: Pick<Workspace, "iterateAllLeaves">,
): void {
  const views: MarkdownView[] = [];
  workspace.iterateAllLeaves((leaf) => {
    if (leaf.view instanceof MarkdownView) views.push(leaf.view);
  });

  const renderersBySurface = new Map<HTMLElement, { view: MarkdownView; items: BacklinksRenderer[] }>();
  for (const renderer of [...renderers]) {
    const view = views.find((candidate) => candidate.contentEl.contains(renderer.rootEl));
    if (!view) continue;
    const surface = renderer.rootEl.closest<HTMLElement>(
      ".markdown-source-view, .markdown-reading-view",
    ) ?? view.contentEl;
    const entry = renderersBySurface.get(surface) ?? { view, items: [] };
    entry.items.push(renderer);
    renderersBySurface.set(surface, entry);
  }

  for (const { view, items } of renderersBySurface.values()) {
    const file = view.file;
    if (!(file instanceof TFile)) continue;
    const keeper = [...items].reverse().find((renderer) => renderer.targetFile.path === file.path)
      ?? items.at(-1);
    if (!keeper) continue;
    for (const renderer of items) {
      if (renderer === keeper) continue;
      renderer.unload();
      renderer.rootEl.remove();
    }
    keeper.retarget(file);
  }
}
