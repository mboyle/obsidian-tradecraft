import { StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, TFile } from "obsidian";
import * as obsidian from "obsidian";
import type { Editor } from "obsidian";
import { BacklinksRenderer, type RendererHost } from "./BacklinksRenderer";

// Obsidian exposes this field at runtime, but does not include it in its public typings.
const { editorEditorField } = obsidian as typeof obsidian & {
  editorEditorField?: StateField<Editor>;
};

class DossierWidget extends WidgetType {
  private renderer?: BacklinksRenderer;

  constructor(
    private readonly targetFile: TFile,
    private readonly host: RendererHost,
  ) {
    super();
  }

  eq(other: DossierWidget): boolean {
    return other.targetFile.path === this.targetFile.path && other.host === this.host;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = view.dom.win.createDiv();
    this.renderer = new BacklinksRenderer(root, this.targetFile, this.host, () => view.requestMeasure());
    this.renderer.load();
    return root;
  }

  destroy(): void {
    this.renderer?.unload();
    this.renderer = undefined;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function createLivePreviewExtension(host: RendererHost): Extension {
  return StateField.define<DecorationSet>({
    create(state): DecorationSet {
      return buildDecorations(state, host);
    },
    update(_decorations, transaction): DecorationSet {
      return buildDecorations(transaction.state, host);
    },
    provide(field): Extension {
      return EditorView.decorations.from(field);
    },
  });
}

function buildDecorations(state: EditorState, host: RendererHost): DecorationSet {
  const info = state.field(editorInfoField, false);
  const livePreview = state.field(editorLivePreviewField, false) ?? false;
  if (!livePreview || !(info?.file instanceof TFile)) return Decoration.none;
  // Table-cell editors inherit the note's file info and Live Preview setting,
  // but have their own Editor. Only the owning note editor gets a footer.
  if (editorEditorField && state.field(editorEditorField, false) !== info.editor) {
    return Decoration.none;
  }
  return Decoration.set([
    Decoration.widget({
      widget: new DossierWidget(info.file, host),
      block: true,
      side: 1,
    }).range(state.doc.length),
  ]);
}
