import { StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, TFile } from "obsidian";
import { BacklinksRenderer, type RendererHost } from "./BacklinksRenderer";

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
    const root = document.createElement("div");
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
  return Decoration.set([
    Decoration.widget({
      widget: new DossierWidget(info.file, host),
      block: true,
      side: 1,
    }).range(state.doc.length),
  ]);
}
