// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  listContinuationForLine,
  listDepthForIndent,
  timelineLivePreviewExtensions,
} from "../src/dailyDates/TimelineLivePreview";

describe("timeline Live Preview list editing", () => {
  it("continues unordered, task, and ordered lists", () => {
    expect(listContinuationForLine("- first", 10, 17)).toEqual({
      insert: "\n- ",
      replaceFrom: 17,
      replaceTo: 17,
    });
    expect(listContinuationForLine("  - [x] done", 20, 32)).toEqual({
      insert: "\n  - [ ] ",
      replaceFrom: 32,
      replaceTo: 32,
    });
    expect(listContinuationForLine("9. ninth", 0, 8)).toEqual({
      insert: "\n10. ",
      replaceFrom: 8,
      replaceTo: 8,
    });
  });

  it("exits an empty list item", () => {
    expect(listContinuationForLine("- ", 4, 6)).toEqual({
      insert: "",
      replaceFrom: 4,
      replaceTo: 6,
    });
    expect(listContinuationForLine("  3. ", 10, 15)).toEqual({
      insert: "",
      replaceFrom: 10,
      replaceTo: 15,
    });
  });

  it("leaves prose Enter behavior to CodeMirror", () => {
    expect(listContinuationForLine("ordinary prose", 0, 8)).toBeNull();
  });

  it("maps tabs and two-space indentation to one visual list level each", () => {
    expect(listDepthForIndent("")).toBe(0);
    expect(listDepthForIndent("\t")).toBe(1);
    expect(listDepthForIndent("\t\t")).toBe(2);
    expect(listDepthForIndent("  ")).toBe(1);
    expect(listDepthForIndent("    ")).toBe(2);
  });

  it("renders clickable link labels in read-only mode", () => {
    const onLinkClick = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "- [[Chest pain|Symptoms]] and [Reference](https://example.com)",
        extensions: [
          EditorState.readOnly.of(true),
          ...timelineLivePreviewExtensions({ onLinkClick }),
        ],
      }),
    });

    const links = host.querySelectorAll<HTMLAnchorElement>("a.dossier-timeline-lp-link-widget");
    expect(Array.from(links, (link) => link.textContent)).toEqual(["Symptoms", "Reference"]);
    links[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onLinkClick).toHaveBeenCalledWith(expect.objectContaining({ target: "Chest pain" }));
    view.destroy();
    host.remove();
  });

  it("reveals link Markdown when the editable caret enters its source range", () => {
    const markdown = "[Chest pain](Chest%20pain)";
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: markdown,
        selection: { anchor: markdown.length },
        extensions: timelineLivePreviewExtensions(),
      }),
    });

    expect(host.querySelector("a.dossier-timeline-lp-link-widget")?.textContent).toBe("Chest pain");
    view.dispatch({ selection: { anchor: 5 } });
    expect(host.querySelector("a.dossier-timeline-lp-link-widget")).toBeNull();
    expect(host.querySelector(".cm-content")?.textContent).toContain(markdown);
    view.destroy();
    host.remove();
  });
});
