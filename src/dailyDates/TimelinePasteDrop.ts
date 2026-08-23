import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { htmlToMarkdown, type App } from "obsidian";

/** Rich clipboard and attachment behavior for the bounded timeline editor. */
export function timelinePasteDropExtensions(app: App, sourcePath: string): Extension[] {
  return [
    EditorView.domEventHandlers({
      paste: (event, view) => handleTimelinePaste(event, view, app, sourcePath),
      drop: (event, view) => handleTimelineDrop(event, view, app, sourcePath),
    }),
  ];
}

export function markdownFromHtml(html: string): string {
  return htmlToMarkdown(html).trimEnd();
}

export function linkForPastedUrl(label: string, url: string): string | null {
  if (label.length === 0 || !/^(?:https?:\/\/|mailto:)[^\s]+$/i.test(url.trim())) return null;
  return `[${label}](${url.trim()})`;
}

function handleTimelinePaste(
  event: ClipboardEvent,
  view: EditorView,
  app: App,
  sourcePath: string,
): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  const files = Array.from(data.files);
  if (files.length > 0) {
    event.preventDefault();
    const selection = view.state.selection.main;
    void insertAttachments(view, app, sourcePath, files, selection.from, selection.to);
    return true;
  }

  const plain = data.getData("text/plain");
  const selection = view.state.selection.main;
  const selected = view.state.sliceDoc(selection.from, selection.to);
  const linkedUrl = linkForPastedUrl(selected, plain);
  if (linkedUrl) {
    event.preventDefault();
    insertText(view, linkedUrl, selection.from, selection.to);
    return true;
  }

  const html = data.getData("text/html");
  if (!html) return false;
  const markdown = markdownFromHtml(html);
  if (!markdown) return false;
  event.preventDefault();
  insertText(view, markdown, selection.from, selection.to);
  return true;
}

function handleTimelineDrop(
  event: DragEvent,
  view: EditorView,
  app: App,
  sourcePath: string,
): boolean {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return false;
  event.preventDefault();
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
    ?? view.state.selection.main.head;
  void insertAttachments(view, app, sourcePath, files, position, position);
  return true;
}

async function insertAttachments(
  view: EditorView,
  app: App,
  sourcePath: string,
  files: File[],
  from: number,
  to: number,
): Promise<void> {
  const links: string[] = [];
  try {
    for (const file of files) {
      const path = await app.fileManager.getAvailablePathForAttachment(file.name, sourcePath);
      const created = await app.vault.createBinary(path, await file.arrayBuffer());
      const link = app.fileManager.generateMarkdownLink(created, sourcePath);
      links.push(isEmbeddable(file) ? `!${link}` : link);
    }
  } catch (error) {
    console.error("Tradecraft: failed to add a timeline attachment", error);
    return;
  }
  if (!view.dom.isConnected || links.length === 0) return;
  const safeFrom = Math.min(from, view.state.doc.length);
  const safeTo = Math.min(Math.max(safeFrom, to), view.state.doc.length);
  insertText(view, links.join("\n"), safeFrom, safeTo);
}

function isEmbeddable(file: File): boolean {
  return /^(?:image|audio|video)\//.test(file.type) || /\.pdf$/i.test(file.name);
}

function insertText(view: EditorView, text: string, from: number, to: number): void {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
    userEvent: "input.paste",
  });
}
