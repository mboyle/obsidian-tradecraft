import {
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type KeyBinding,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";

interface LinePrefix {
  indent: string;
  marker: string;
  task?: string;
  content: string;
}

interface DecorationRange {
  from: number;
  to: number;
  decoration: Decoration;
}

export interface TimelineLinkClick {
  target: string;
  event: MouseEvent;
}

export interface TimelineLivePreviewOptions {
  onLinkClick?: (click: TimelineLinkClick) => void;
}

const BULLET_PREFIX = /^(\s*)([-+*])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const ORDERED_PREFIX = /^(\s*)(\d+)([.)])\s+(.*)$/;

/**
 * A small presentation layer for the timeline's bounded CodeMirror editor.
 * Obsidian doesn't expose its full Live Preview extension bundle, so this
 * deliberately covers the common prose structures used in Daily Notes while
 * leaving the active line as editable Markdown.
 */
export function timelineLivePreviewExtensions(
  options: TimelineLivePreviewOptions = {},
): Extension[] {
  const bindings: readonly KeyBinding[] = [
    { key: "Enter", run: continueMarkdownList },
    indentWithTab,
    ...defaultKeymap,
    ...historyKeymap,
  ];
  return [
    history(),
    keymap.of(bindings),
    createTimelineDecorations(options),
  ];
}

export interface ListContinuation {
  insert: string;
  replaceFrom: number;
  replaceTo: number;
}

export function listContinuationForLine(
  lineText: string,
  lineFrom: number,
  cursor: number,
): ListContinuation | null {
  const offset = cursor - lineFrom;
  if (offset < 0 || offset > lineText.length) return null;
  const beforeCursor = lineText.slice(0, offset);
  const bullet = BULLET_PREFIX.exec(beforeCursor);
  if (bullet) {
    const prefix = readBulletPrefix(bullet);
    const prefixLength = prefix.indent.length + prefix.marker.length + 1
      + (prefix.task === undefined ? 0 : 4);
    if (prefix.content.trim().length === 0 && offset <= prefixLength) {
      return { insert: "", replaceFrom: lineFrom, replaceTo: cursor };
    }
    const task = prefix.task === undefined ? "" : "[ ] ";
    return {
      insert: `\n${prefix.indent}${prefix.marker} ${task}`,
      replaceFrom: cursor,
      replaceTo: cursor,
    };
  }

  const ordered = ORDERED_PREFIX.exec(beforeCursor);
  if (!ordered) return null;
  const indent = ordered[1] ?? "";
  const number = Number(ordered[2] ?? "1");
  const punctuation = ordered[3] ?? ".";
  const content = ordered[4] ?? "";
  if (content.trim().length === 0) {
    return { insert: "", replaceFrom: lineFrom, replaceTo: cursor };
  }
  return {
    insert: `\n${indent}${number + 1}${punctuation} `,
    replaceFrom: cursor,
    replaceTo: cursor,
  };
}

function continueMarkdownList(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const line = view.state.doc.lineAt(selection.head);
  const continuation = listContinuationForLine(line.text, line.from, selection.head);
  if (!continuation) return false;
  view.dispatch({
    changes: {
      from: continuation.replaceFrom,
      to: continuation.replaceTo,
      insert: continuation.insert,
    },
    selection: { anchor: continuation.replaceFrom + continuation.insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

function createTimelineDecorations(options: TimelineLivePreviewOptions): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view, options);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view, options);
      }
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  });
}

function buildDecorations(
  view: EditorView,
  options: TimelineLivePreviewOptions,
): DecorationSet {
  const ranges: DecorationRange[] = [];
  for (let number = 1; number <= view.state.doc.lines; number += 1) {
    const line = view.state.doc.line(number);
    decorateLine(view, line.from, line.to, line.text, ranges, options);
  }
  const sorted = ranges
    .map(({ from, to, decoration }) => decoration.range(from, to))
    .sort((left, right) => left.from - right.from || left.to - right.to);
  return Decoration.set(sorted, true);
}

function decorateLine(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  ranges: DecorationRange[],
  options: TimelineLivePreviewOptions,
): void {
  if (text.trim().length === 0) {
    addLineDecoration(from, "dossier-timeline-lp-blank", ranges);
    return;
  }

  const heading = /^(\s*)(#{1,6})\s+(.*)$/.exec(text);
  if (heading) {
    const indent = heading[1] ?? "";
    const markers = heading[2] ?? "#";
    addLineDecoration(from, `dossier-timeline-lp-heading dossier-timeline-lp-h${markers.length}`, ranges);
    const markerFrom = from + indent.length;
    const markerTo = markerFrom + markers.length + 1;
    if (!selectionTouchesRange(view, markerFrom, markerTo)) {
      replace(markerFrom, markerTo, undefined, ranges);
    }
  } else {
    const bullet = BULLET_PREFIX.exec(text);
    const ordered = ORDERED_PREFIX.exec(text);
    if (bullet) decorateBullet(view, from, bullet, ranges);
    else if (ordered) decorateOrdered(view, from, ordered, ranges);
    else {
      const quote = /^(\s*)>\s?(.*)$/.exec(text);
      if (quote) {
        const indent = quote[1] ?? "";
        addLineDecoration(from, "dossier-timeline-lp-quote", ranges);
        const markerFrom = from + indent.length;
        const markerTo = markerFrom + (text[indent.length + 1] === " " ? 2 : 1);
        if (!selectionTouchesRange(view, markerFrom, markerTo)) {
          replace(markerFrom, markerTo, undefined, ranges);
        }
      } else if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
        addLineDecoration(from, "dossier-timeline-lp-rule", ranges);
        if (!selectionTouchesRange(view, from, to)) {
          replace(from, to, new RuleWidget(), ranges);
        }
      } else {
        addLineDecoration(from, "dossier-timeline-lp-paragraph", ranges);
      }
    }
  }

  decorateInlineSyntax(view, from, text, ranges, options);
}

function decorateBullet(
  view: EditorView,
  lineFrom: number,
  match: RegExpExecArray,
  ranges: DecorationRange[],
): void {
  const prefix = readBulletPrefix(match);
  const markerFrom = lineFrom + prefix.indent.length;
  addLineDecoration(lineFrom, `dossier-timeline-lp-list dossier-timeline-lp-depth-${listDepthForIndent(prefix.indent)}`, ranges);
  if (prefix.task !== undefined) {
    const markerLength = prefix.marker.length + 1 + 4;
    replace(
      lineFrom,
      markerFrom + markerLength,
      new TaskWidget(prefix.task.toLowerCase() === "x", markerFrom + 2, markerFrom + 5),
      ranges,
    );
  } else {
    const markerTo = markerFrom + prefix.marker.length + 1;
    replace(lineFrom, markerTo, new BulletWidget(), ranges);
  }
}

function decorateOrdered(
  view: EditorView,
  lineFrom: number,
  match: RegExpExecArray,
  ranges: DecorationRange[],
): void {
  const indent = match[1] ?? "";
  const number = match[2] ?? "1";
  const punctuation = match[3] ?? ".";
  addLineDecoration(lineFrom, `dossier-timeline-lp-list dossier-timeline-lp-depth-${listDepthForIndent(indent)}`, ranges);
  const markerFrom = lineFrom + indent.length;
  const markerTo = markerFrom + number.length + punctuation.length + 1;
  replace(lineFrom, markerTo, new OrderedWidget(`${number}${punctuation}`), ranges);
}

function decorateInlineSyntax(
  view: EditorView,
  lineFrom: number,
  text: string,
  ranges: DecorationRange[],
  options: TimelineLivePreviewOptions,
): void {
  forEachMatch(/`([^`\n]+)`/g, text, (match) => {
    const raw = match[0];
    const start = lineFrom + match.index;
    mark(start + 1, start + raw.length - 1, "dossier-timeline-lp-code", ranges);
    hidePairUnlessSelected(view, start, start + raw.length, 1, ranges);
  });
  forEachMatch(/~~([^~\n]+)~~/g, text, (match) => {
    const raw = match[0];
    const start = lineFrom + match.index;
    mark(start + 2, start + raw.length - 2, "dossier-timeline-lp-strike", ranges);
    hidePairUnlessSelected(view, start, start + raw.length, 2, ranges);
  });
  forEachMatch(/(?:\*\*|__)(\S(?:.*?\S)?)(?:\*\*|__)/g, text, (match) => {
    const raw = match[0];
    const start = lineFrom + match.index;
    mark(start + 2, start + raw.length - 2, "dossier-timeline-lp-strong", ranges);
    hidePairUnlessSelected(view, start, start + raw.length, 2, ranges);
  });
  forEachMatch(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, text, (match) => {
    const prefix = match[1] ?? "";
    const start = lineFrom + match.index + prefix.length;
    const length = match[0].length - prefix.length;
    mark(start + 1, start + length - 1, "dossier-timeline-lp-em", ranges);
    hidePairUnlessSelected(view, start, start + length, 1, ranges);
  });
  forEachMatch(/(^|[^_])_([^_\n]+)_(?!_)/g, text, (match) => {
    const prefix = match[1] ?? "";
    const start = lineFrom + match.index + prefix.length;
    const length = match[0].length - prefix.length;
    mark(start + 1, start + length - 1, "dossier-timeline-lp-em", ranges);
    hidePairUnlessSelected(view, start, start + length, 1, ranges);
  });
  forEachMatch(/\[\[([^\]\n]+)\]\]/g, text, (match) => {
    const start = lineFrom + match.index;
    const end = start + match[0].length;
    const inside = match[1] ?? "";
    const separator = inside.indexOf("|");
    const target = separator < 0 ? inside : inside.slice(0, separator);
    const label = separator < 0 ? inside : inside.slice(separator + 1);
    decorateLink(view, start, end, label, target, false, ranges, options);
  });
  forEachMatch(/\[([^\]\n]+)\]\(([^\n)]+)\)/g, text, (match) => {
    const start = lineFrom + match.index;
    const end = start + match[0].length;
    const label = match[1] ?? "";
    const target = (match[2] ?? "").replace(/^<|>$/g, "");
    decorateLink(view, start, end, label, target, isExternalTarget(target), ranges, options);
  });
}

function decorateLink(
  view: EditorView,
  from: number,
  to: number,
  label: string,
  target: string,
  external: boolean,
  ranges: DecorationRange[],
  options: TimelineLivePreviewOptions,
): void {
  if (selectionTouchesRange(view, from, to)) {
    mark(from, to, "dossier-timeline-lp-link", ranges);
    return;
  }
  replace(from, to, new LinkWidget(label, target, external, options.onLinkClick), ranges);
}

function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(target);
}

function hidePairUnlessSelected(
  view: EditorView,
  start: number,
  end: number,
  size: number,
  ranges: DecorationRange[],
): void {
  if (!selectionTouchesRange(view, start, start + size)) {
    replace(start, start + size, undefined, ranges);
  }
  if (!selectionTouchesRange(view, end - size, end)) {
    replace(end - size, end, undefined, ranges);
  }
}

function addLineDecoration(from: number, classes: string, ranges: DecorationRange[]): void {
  ranges.push({
    from,
    to: from,
    decoration: Decoration.line({ class: classes }),
  });
}

function mark(from: number, to: number, className: string, ranges: DecorationRange[]): void {
  if (to <= from) return;
  ranges.push({ from, to, decoration: Decoration.mark({ class: className }) });
}

function replace(
  from: number,
  to: number,
  widget: WidgetType | undefined,
  ranges: DecorationRange[],
): void {
  if (to <= from) return;
  ranges.push({
    from,
    to,
    decoration: Decoration.replace(widget ? { widget } : {}),
  });
}

function selectionTouchesRange(view: EditorView, from: number, to: number): boolean {
  if (view.state.readOnly) return false;
  return view.state.selection.ranges.some((range) => range.from < to && range.to >= from);
}

function readBulletPrefix(match: RegExpExecArray): LinePrefix {
  return {
    indent: match[1] ?? "",
    marker: match[2] ?? "-",
    task: match[3],
    content: match[4] ?? "",
  };
}

export function listDepthForIndent(indent: string): number {
  const tabs = [...indent].filter((character) => character === "\t").length;
  const spaces = [...indent].filter((character) => character === " ").length;
  return Math.min(6, tabs + Math.floor(spaces / 2));
}

function forEachMatch(regex: RegExp, text: string, callback: (match: RegExpExecArray) => void): void {
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    callback(match);
    if (match[0].length === 0) regex.lastIndex += 1;
  }
}

class BulletWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const bullet = view.dom.ownerDocument.createElement("span");
    bullet.className = "dossier-timeline-lp-bullet list-bullet";
    bullet.setAttribute("aria-hidden", "true");
    return bullet;
  }
}

class OrderedWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  eq(other: OrderedWidget): boolean {
    return this.label === other.label;
  }

  toDOM(view: EditorView): HTMLElement {
    const marker = view.dom.ownerDocument.createElement("span");
    marker.className = "dossier-timeline-lp-ordered";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = this.label;
    return marker;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: TaskWidget): boolean {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = view.dom.ownerDocument.createElement("input");
    input.className = "dossier-timeline-lp-task";
    input.type = "checkbox";
    input.checked = this.checked;
    input.addEventListener("change", () => {
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: input.checked ? "[x]" : "[ ]" },
        userEvent: "input",
      });
      view.focus();
    });
    return input;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "change" && event.type !== "click" && event.type !== "mousedown";
  }
}

class LinkWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly target: string,
    private readonly external: boolean,
    private readonly onClick: TimelineLivePreviewOptions["onLinkClick"],
  ) {
    super();
  }

  eq(other: LinkWidget): boolean {
    return this.label === other.label
      && this.target === other.target
      && this.external === other.external
      && this.onClick === other.onClick;
  }

  toDOM(view: EditorView): HTMLElement {
    const link = view.dom.ownerDocument.createElement("a");
    link.className = this.external
      ? "dossier-timeline-lp-link-widget external-link"
      : "dossier-timeline-lp-link-widget internal-link";
    link.textContent = this.label;
    link.href = this.external ? this.target : "#";
    if (!this.external) link.dataset.href = this.target;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onClick?.({ target: this.target, event });
    });
    return link;
  }
}

class RuleWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const rule = view.dom.ownerDocument.createElement("span");
    rule.className = "dossier-timeline-lp-rule-widget";
    rule.setAttribute("aria-hidden", "true");
    return rule;
  }
}
