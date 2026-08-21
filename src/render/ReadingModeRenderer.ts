import {
  MarkdownRenderChild,
  MarkdownView,
  TFile,
  type MarkdownPostProcessor,
  type MarkdownPostProcessorContext,
  type Workspace,
} from "obsidian";
import { BacklinksRenderer, type RendererHost } from "./BacklinksRenderer";

class DossierReadingChild extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private readonly targetFile: TFile,
    private readonly host: RendererHost,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.addChild(new BacklinksRenderer(this.containerEl, this.targetFile, this.host));
  }
}

export class ReadingModeRenderer {
  private readonly fallbacks = new Map<MarkdownView, DossierReadingChild>();

  constructor(private readonly host: RendererHost) {}

  readonly postProcessor: MarkdownPostProcessor = (
    el: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): void => {
    if (el.closest(".dossier-backlink-context, .dossier-daily-timeline")) return;
    const target = this.host.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(target instanceof TFile)) return;
    const sectionInfo = context.getSectionInfo(el);
    const cache = this.host.app.metadataCache.getFileCache(target);
    const terminalLine = cache?.sections?.at(-1)?.position.end.line;
    if (sectionInfo && terminalLine !== undefined && sectionInfo.lineEnd < terminalLine) return;
    if (!sectionInfo && terminalLine !== undefined) return;
    if (el.querySelector(`:scope > .dossier-backlinks[data-dossier-target="${cssEscape(target.path)}"]`)) return;

    const root = document.createElement("div");
    el.append(root);
    context.addChild(new DossierReadingChild(root, target, this.host));
  };

  reconcileEmptyViews(workspace: Workspace): void {
    const visibleViews = new Set<MarkdownView>();
    workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const view = leaf.view;
      visibleViews.add(view);
      const file = view.file;
      const isEmptyPreview =
        view.getMode() === "preview" &&
        file instanceof TFile &&
        (this.host.app.metadataCache.getFileCache(file)?.sections?.length ?? 0) === 0;
      if (!isEmptyPreview) {
        this.removeFallback(view);
        return;
      }
      const existingBacklinks = view.previewMode.containerEl.querySelector<HTMLElement>(
        `.dossier-backlinks[data-dossier-target="${cssEscape(file.path)}"]`,
      );
      if (existingBacklinks) {
        existingBacklinks
          .closest<HTMLElement>(".dossier-reading-fallback")
          ?.parentElement?.classList.add("dossier-has-reading-fallback");
        return;
      }
      const previewEl = view.previewMode.containerEl.matches(".markdown-preview-view")
        ? view.previewMode.containerEl
        : view.previewMode.containerEl.querySelector<HTMLElement>(".markdown-preview-view");
      if (!previewEl) return;
      const root = document.createElement("div");
      root.classList.add("dossier-reading-fallback");
      previewEl.classList.add("dossier-has-reading-fallback");
      previewEl.append(root);
      const child = new DossierReadingChild(root, file, this.host);
      child.load();
      this.fallbacks.set(view, child);
    });
    for (const view of this.fallbacks.keys()) {
      if (!visibleViews.has(view)) this.removeFallback(view);
    }
  }

  destroy(): void {
    for (const view of [...this.fallbacks.keys()]) this.removeFallback(view);
  }

  private removeFallback(view: MarkdownView): void {
    const child = this.fallbacks.get(view);
    if (!child) return;
    const previewEl = child.containerEl.parentElement;
    child.unload();
    child.containerEl.remove();
    previewEl?.classList.remove("dossier-has-reading-fallback");
    this.fallbacks.delete(view);
  }
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape(value) ?? value.replace(/["\\]/g, "\\$&");
}
