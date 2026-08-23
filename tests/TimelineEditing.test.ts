// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  listBackspaceChange,
  wrapSelection,
} from "../src/dailyDates/TimelineEditing";

describe("timeline editing essentials", () => {
  it("wraps and unwraps selected Markdown", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: "word", selection: { anchor: 0, head: 4 } }),
    });

    wrapSelection(view, { open: "**", close: "**" });
    expect(view.state.doc.toString()).toBe("**word**");
    expect(view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    )).toBe("word");

    view.dispatch({ selection: { anchor: 0, head: 8 } });
    wrapSelection(view, { open: "**", close: "**" });
    expect(view.state.doc.toString()).toBe("word");
    view.destroy();
    host.remove();
  });

  it("places an empty formatting pair around the caret", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: "text", selection: { anchor: 4 } }),
    });
    wrapSelection(view, { open: "==", close: "==" });
    expect(view.state.doc.toString()).toBe("text====");
    expect(view.state.selection.main.head).toBe(6);
    view.destroy();
    host.remove();
  });

  it("exits and outdents list items with Backspace", () => {
    expect(listBackspaceChange("- ", 10, 12)).toEqual({ from: 10, to: 12 });
    expect(listBackspaceChange("- item", 0, 2)).toEqual({ from: 0, to: 2 });
    expect(listBackspaceChange("  - item", 0, 4)).toEqual({ from: 0, to: 2 });
    expect(listBackspaceChange("\t- item", 0, 3)).toEqual({ from: 0, to: 1 });
    expect(listBackspaceChange("- item", 0, 4)).toBeNull();
  });
});
