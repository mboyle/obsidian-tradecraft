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
  it.each(["  7. [ ] task", "  10) ordinary item"])("moves the caret through real numbered-list text: %s", (doc) => {
    const host = document.body.appendChild(document.createElement("div"));
    const markerFrom = 2;
    const markerEnd = doc.indexOf(" ", markerFrom);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        selection: { anchor: markerEnd },
        extensions: timelineLivePreviewExtensions(),
      }),
    });
    for (let position = markerEnd - 1; position >= markerFrom; position -= 1) {
      view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      expect(view.state.selection.main.head).toBe(position);
      const text = host.querySelector(".dossier-timeline-lp-ordered")?.firstChild;
      if (!text) throw new Error("Expected editable numbered-list text");
      expect(text.nodeType).toBe(Node.TEXT_NODE);
      expect(text.textContent).toBe(doc.slice(markerFrom, markerEnd));
      expect(view.posAtDOM(text, position - markerFrom)).toBe(position);
    }
    view.dispatch({ changes: { from: markerFrom, to: markerFrom + 1, insert: "9" } });
    expect(host.querySelector(".dossier-timeline-lp-ordered")?.textContent).toBe(doc.slice(markerFrom, markerEnd).replace(/^./, "9"));
    view.destroy();
    host.remove();
  });

  it.each(["  - [ ] task", "  10. [x] task"])("reveals the task source beside the caret: %s", (doc) => {
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: timelineLivePreviewExtensions(),
      }),
    });
    expect(host.querySelector("input[type=checkbox]")).not.toBeNull();
    const number = host.querySelector(".dossier-timeline-lp-ordered");
    for (const anchor of [doc.indexOf("["), doc.indexOf("]") + 1, doc.indexOf("task")]) {
      view.dispatch({ selection: { anchor } });
      expect(host.querySelector("input[type=checkbox]")).toBeNull();
      expect(host.querySelector(".dossier-timeline-lp-task-source")?.textContent).toBe(doc.includes("[x]") ? "[x]" : "[ ]");
      expect(view.contentDOM.textContent).toBe(number ? "10. [x] task" : "[ ] task");
      expect(host.querySelector(".dossier-timeline-lp-ordered")?.textContent ?? null).toBe(number?.textContent ?? null);
    }
    view.dispatch({ selection: { anchor: doc.length } });
    expect(host.querySelector("input[type=checkbox]")).not.toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
    host.remove();
  });

  it("toggles nested tasks with variable spacing and supports undo after positions move", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "Heading\n  10.   [ ] buy milk\n+ [X] done",
        extensions: timelineLivePreviewExtensions(),
      }),
    });
    view.dispatch({ changes: { from: 0, insert: "New\n" } });
    const checkbox = host.querySelector<HTMLInputElement>("input[type=checkbox]");
    checkbox?.click();
    expect(view.state.doc.toString()).toBe("New\nHeading\n  10.   [x] buy milk\n+ [X] done");
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true }));
    expect(view.state.doc.toString()).toContain("  10.   [ ] buy milk");
    host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1]?.click();
    expect(view.state.doc.toString()).toContain("+ [ ] done");
    view.destroy();
    host.remove();
  });

  it("delegates read-only checkbox clicks without changing the preview document", () => {
    const onTaskToggle = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "- [ ] task\n```\n- [ ] code\n```",
        extensions: [EditorState.readOnly.of(true), ...timelineLivePreviewExtensions({ onTaskToggle })],
      }),
    });
    expect(host.querySelectorAll("input[type=checkbox]")).toHaveLength(1);
    host.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
    expect(onTaskToggle).toHaveBeenCalledWith(2, 5, true);
    expect(view.state.doc.toString()).toContain("- [ ] task");
    view.destroy();
    host.remove();
  });

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
    expect(listContinuationForLine("  10. [X] done", 0, 14)?.insert).toBe("\n  11. [ ] ");
    expect(listContinuationForLine("1. [ ] ", 0, 7)?.insert).toBe("");
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

  it("renders tags, highlights, comments, and media in read-only mode", () => {
    const onTagClick = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "==important== %%private%% #launch\n![[pitch.png]]",
        extensions: [
          EditorState.readOnly.of(true),
          ...timelineLivePreviewExtensions({
            onTagClick,
            resolveEmbed: () => ({ src: "app://pitch.png", kind: "image" }),
          }),
        ],
      }),
    });

    expect(host.querySelector(".dossier-timeline-lp-highlight")?.textContent).toBe("important");
    expect(host.querySelector(".cm-content")?.textContent).not.toContain("private");
    const tag = host.querySelector<HTMLAnchorElement>("a.dossier-timeline-lp-tag");
    expect(tag?.textContent).toBe("#launch");
    tag?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onTagClick).toHaveBeenCalledWith("launch", expect.any(MouseEvent));
    expect(host.querySelector<HTMLImageElement>("img.dossier-timeline-lp-embed")?.src).toContain("pitch.png");
    view.destroy();
    host.remove();
  });
});
