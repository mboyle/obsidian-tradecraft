import { Keymap, MarkdownView, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import type { ResolvedReference } from "../types";

export class ReferenceNavigator {
  constructor(private readonly app: App) {}

  async open(sourceFile: TFile, occurrence: ResolvedReference, event?: MouseEvent | KeyboardEvent): Promise<void> {
    const pane = Keymap.isModEvent(event ?? null);
    const leaf = this.app.workspace.getLeaf(pane);
    await leaf.openFile(sourceFile, { active: true });
    await this.revealInLeaf(leaf, sourceFile, occurrence);
  }

  private async revealInLeaf(
    leaf: WorkspaceLeaf,
    sourceFile: TFile,
    occurrence: ResolvedReference,
  ): Promise<void> {
    let view = leaf.view;
    if (view instanceof MarkdownView && view.getMode() === "preview") {
      try {
        const viewState = leaf.getViewState();
        await leaf.setViewState({
          ...viewState,
          active: true,
          state: { ...viewState.state, file: sourceFile.path, mode: "source" },
        });
        view = leaf.view;
      } catch (error) {
        console.debug("[Dossier] Could not switch source to Live Preview for exact navigation", error);
      }
    }

    if (!(view instanceof MarkdownView)) return;
    const from = { line: occurrence.startLine, ch: occurrence.startColumn };
    const to = { line: occurrence.endLine, ch: occurrence.endColumn };
    view.editor.setSelection(from, to);
    view.editor.scrollIntoView({ from, to }, true);
    view.editor.focus();
  }
}
