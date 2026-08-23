import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  indentUnit,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import {
  EditorSelection,
  EditorState,
  Prec,
  type Extension,
} from "@codemirror/state";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
  type KeyBinding,
} from "@codemirror/view";

export interface MarkdownWrap {
  open: string;
  close: string;
}

const EMPTY_OR_PREFIX_ONLY_LIST = /^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?$/;
const LIST_PREFIX = /^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/;

/** The general editing behaviors Obsidian users expect from a Markdown editor. */
export function timelineEditingExtensions(): Extension[] {
  const formattingBindings: readonly KeyBinding[] = [
    { key: "Mod-b", run: (view) => wrapSelection(view, { open: "**", close: "**" }) },
    { key: "Mod-i", run: (view) => wrapSelection(view, { open: "*", close: "*" }) },
    { key: "Mod-Shift-x", run: (view) => wrapSelection(view, { open: "~~", close: "~~" }) },
    { key: "Mod-Shift-h", run: (view) => wrapSelection(view, { open: "==", close: "==" }) },
    { key: "Mod-`", run: (view) => wrapSelection(view, { open: "`", close: "`" }) },
    { key: "Backspace", run: handleListBackspace },
    indentWithTab,
  ];

  return [
    EditorState.allowMultipleSelections.of(true),
    indentUnit.of("  "),
    markdown(),
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    bracketMatching(),
    closeBrackets(),
    search({ top: true }),
    highlightSelectionMatches(),
    EditorView.contentAttributes.of({
      spellcheck: "true",
      autocorrect: "on",
      autocapitalize: "sentences",
    }),
    Prec.highest(keymap.of(formattingBindings)),
    keymap.of([...closeBracketsKeymap, ...searchKeymap, ...defaultKeymap]),
  ];
}

export function wrapSelection(view: EditorView, wrap: MarkdownWrap): boolean {
  const transaction = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    if (range.empty) {
      const insert = `${wrap.open}${wrap.close}`;
      return {
        changes: { from: range.from, insert },
        range: EditorSelection.cursor(range.from + wrap.open.length),
      };
    }

    if (selected.startsWith(wrap.open) && selected.endsWith(wrap.close)
      && selected.length >= wrap.open.length + wrap.close.length) {
      const inner = selected.slice(wrap.open.length, selected.length - wrap.close.length);
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }

    return {
      changes: {
        from: range.from,
        to: range.to,
        insert: `${wrap.open}${selected}${wrap.close}`,
      },
      range: EditorSelection.range(
        range.from + wrap.open.length,
        range.to + wrap.open.length,
      ),
    };
  });
  view.dispatch(transaction, { scrollIntoView: true, userEvent: "input" });
  return true;
}

export function listBackspaceChange(
  lineText: string,
  lineFrom: number,
  cursor: number,
): { from: number; to: number } | null {
  const offset = cursor - lineFrom;
  if (offset < 0 || offset > lineText.length) return null;
  const prefix = LIST_PREFIX.exec(lineText);
  if (!prefix) return null;
  const prefixLength = prefix[0].length;
  const indent = prefix[1] ?? "";

  if (EMPTY_OR_PREFIX_ONLY_LIST.test(lineText) && offset >= prefixLength) {
    return { from: lineFrom, to: lineFrom + prefixLength };
  }
  if (offset !== prefixLength) return null;
  if (indent.startsWith("\t")) return { from: lineFrom, to: lineFrom + 1 };
  if (indent.length > 0) return { from: lineFrom, to: lineFrom + Math.min(2, indent.length) };
  return { from: lineFrom, to: lineFrom + prefixLength };
}

function handleListBackspace(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const line = view.state.doc.lineAt(selection.head);
  const change = listBackspaceChange(line.text, line.from, selection.head);
  if (!change) return false;
  view.dispatch({
    changes: change,
    selection: { anchor: selection.head - (change.to - change.from) },
    scrollIntoView: true,
    userEvent: "delete.backward",
  });
  return true;
}
