import { EditorState, type StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { editorEditorField, editorInfoField, editorLivePreviewField, TFile } from "./mocks/obsidian";
import { createLivePreviewExtension } from "../src/render/LivePreviewExtension";
import type { RendererHost } from "../src/render/BacklinksRenderer";

describe("Live Preview backlinks", () => {
  function createEditor({ nested = false, livePreview = true, file = new TFile("Note.md") as TFile | null } = {}) {
    const editor = {};
    const field = createLivePreviewExtension({} as RendererHost) as StateField<DecorationSet>;
    const state = EditorState.create({
      doc: nested ? "Cell" : "| Header |\n| --- |\n| Cell |",
      extensions: [
        editorInfoField.init(() => ({ file, editor })),
        editorEditorField.init(() => nested ? {} : editor),
        editorLivePreviewField.init(() => livePreview),
        field,
      ],
    });
    return { state, field };
  }

  it("keeps the footer at the end of the note, including after edits", () => {
    const { state, field } = createEditor();
    expect(state.field(field).size).toBe(1);
    const updated = state.update({ changes: { from: state.doc.length, insert: "\nMore text" } }).state;
    const decorations = updated.field(field).iter();
    expect(decorations.from).toBe(updated.doc.length);
    expect(decorations.value?.spec.block).toBe(true);
  });

  it("does not insert a footer in a table-cell editor sharing the note's info", () => {
    const { state, field } = createEditor({ nested: true });
    expect(state.field(field).size).toBe(0);
    const updated = state.update({ changes: { from: 0, insert: "Edited " } }).state;
    expect(updated.field(field).size).toBe(0);
  });

  it.each([{ livePreview: false }, { file: null }])("skips editors without Live Preview or a file: %o", (options) => {
    const { state, field } = createEditor(options);
    expect(state.field(field).size).toBe(0);
  });
});
