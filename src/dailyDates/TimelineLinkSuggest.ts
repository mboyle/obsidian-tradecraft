import {
  autocompletion,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  getAllTags,
  parseFrontMatterAliases,
  type App,
  type HeadingCache,
  type TFile,
} from "obsidian";

export interface TimelineWikiLinkMatch {
  from: number;
  query: string;
}

export interface TimelineWikiLinkPairInsertion {
  insert: string;
  anchor: number;
}

export function timelineWikiLinkPairInsertion(
  textBeforeInput: string,
  from: number,
  to: number,
  text: string,
  textAfterInput: string,
): TimelineWikiLinkPairInsertion | null {
  if (text !== "[" || from !== to || !textBeforeInput.endsWith("[") || textAfterInput.startsWith("]]")) {
    return null;
  }
  return { insert: "[]]", anchor: from + 1 };
}

/** Find an unfinished wiki link immediately before the caret. */
export function timelineWikiLinkMatch(textBeforeCaret: string, caret: number): TimelineWikiLinkMatch | null {
  const match = /\[\[([^\]\n]*)$/.exec(textBeforeCaret);
  if (!match || match.index === undefined) return null;
  return {
    from: caret - (match[1]?.length ?? 0),
    query: match[1] ?? "",
  };
}

export function timelineWikiLinkCompletions(
  app: App,
  sourcePath: string,
  linkStart = 0,
): Completion[] {
  const options: Completion[] = [];
  for (const file of app.vault.getFiles()) {
    options.push(fileCompletion(app, file, sourcePath, linkStart));
    if (file.extension !== "md") continue;
    const aliases = parseFrontMatterAliases(app.metadataCache.getFileCache(file)?.frontmatter ?? null) ?? [];
    for (const alias of aliases) {
      options.push(fileCompletion(app, file, sourcePath, linkStart, alias));
    }
  }
  return options;
}

export function timelineTagCompletions(app: App): Completion[] {
  const tags = new Set<string>();
  for (const file of app.vault.getMarkdownFiles()) {
    for (const tag of getAllTags(app.metadataCache.getFileCache(file) ?? {}) ?? []) {
      tags.add(tag.replace(/^#/, ""));
    }
  }
  return [...tags]
    .sort((left, right) => left.localeCompare(right))
    .map((tag) => ({ label: tag, type: "keyword", apply: tag }));
}

/**
 * Native-feeling wiki-link, tag, and slash-command completion for the
 * timeline's bounded editor. Obsidian's private editor extension bundle cannot
 * be mounted independently, so these sources use the public vault, metadata,
 * and FileManager APIs and honor the vault's configured link format.
 */
export function timelineWikiLinkExtensions(app: App, sourcePath: string): Extension[] {
  return [
    EditorView.inputHandler.of((view, from, to, text) => {
      const pairing = timelineWikiLinkPairInsertion(
        view.state.sliceDoc(Math.max(0, from - 1), from),
        from,
        to,
        text,
        view.state.sliceDoc(from, from + 2),
      );
      if (!pairing) return false;
      view.dispatch({
        changes: { from, to, insert: pairing.insert },
        selection: { anchor: pairing.anchor },
        userEvent: "input.type",
      });
      return true;
    }),
    autocompletion({
      override: [
        (context) => wikiLinkCompletionSource(context, app, sourcePath),
        (context) => tagCompletionSource(context, app),
        slashCommandCompletionSource,
      ],
      activateOnTyping: true,
      activateOnTypingDelay: 0,
      maxRenderedOptions: 50,
    }),
  ];
}

function wikiLinkCompletionSource(
  context: CompletionContext,
  app: App,
  sourcePath: string,
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const match = timelineWikiLinkMatch(
    context.state.sliceDoc(line.from, context.pos),
    context.pos,
  );
  if (!match || match.query.includes("|")) return null;

  const linkStart = match.from - 2;
  if (match.query.startsWith("##")) {
    return completionResult(match.from + 2, globalHeadingCompletions(app, sourcePath, linkStart));
  }
  if (match.query.startsWith("^^")) {
    return completionResult(match.from + 2, globalBlockCompletions(app, sourcePath, linkStart));
  }

  const hash = match.query.indexOf("#");
  if (hash >= 0) {
    const fileQuery = match.query.slice(0, hash);
    const subpathQuery = match.query.slice(hash + 1);
    const file = resolveLinkTarget(app, fileQuery, sourcePath);
    if (!file) return completionResult(match.from + hash + 1, []);
    const options = subpathQuery.startsWith("^")
      ? blockCompletions(app, file, sourcePath, linkStart)
      : headingCompletions(app, file, sourcePath, linkStart);
    return completionResult(match.from + hash + 1 + (subpathQuery.startsWith("^") ? 1 : 0), options);
  }

  return completionResult(
    match.from,
    timelineWikiLinkCompletions(app, sourcePath, linkStart),
  );
}

function tagCompletionSource(context: CompletionContext, app: App): CompletionResult | null {
  const before = context.state.sliceDoc(context.state.doc.lineAt(context.pos).from, context.pos);
  const match = /(?:^|[\s(])#([^\s#[\]]*)$/.exec(before);
  if (!match) return null;
  return {
    from: context.pos - (match[1]?.length ?? 0),
    options: timelineTagCompletions(app),
    validFor: /^[\p{L}\p{N}_\-/]*$/u,
  };
}

function slashCommandCompletionSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const match = /(?:^|\s)\/([\p{L}\p{N} -]*)$/u.exec(before);
  if (!match) return null;
  const slashOffset = match.index + (match[0].startsWith("/") ? 0 : 1);
  const commandStart = line.from + slashOffset;
  const from = commandStart + 1;
  return {
    from,
    options: slashCommandCompletions(commandStart),
    validFor: /^[\p{L}\p{N} -]*$/u,
  };
}

function slashCommandCompletions(commandStart: number): Completion[] {
  return [
    command(commandStart, "Bullet list", "List", "- "),
    command(commandStart, "Numbered list", "List", "1. "),
    command(commandStart, "Task", "List", "- [ ] "),
    command(commandStart, "Heading 1", "Heading", "# "),
    command(commandStart, "Heading 2", "Heading", "## "),
    command(commandStart, "Heading 3", "Heading", "### "),
    command(commandStart, "Quote", "Block", "> "),
    command(commandStart, "Callout", "Block", "> [!note]\n> "),
    command(commandStart, "Divider", "Block", "---"),
    cursorCommand(commandStart, "Code block", "Block", "```\n\n```", 4),
    cursorCommand(commandStart, "Internal link", "Link", "[[]]", 2),
    cursorCommand(commandStart, "Markdown link", "Link", "[]()", 1),
  ];
}

function command(commandStart: number, label: string, detail: string, insert: string): Completion {
  return cursorCommand(commandStart, label, detail, insert, insert.length);
}

function cursorCommand(
  commandStart: number,
  label: string,
  detail: string,
  insert: string,
  cursorOffset: number,
): Completion {
  return {
    label,
    detail,
    type: "keyword",
    apply: (view, completion, _from, to) => {
      view.dispatch({
        changes: { from: commandStart, to, insert },
        selection: { anchor: commandStart + cursorOffset },
        annotations: pickedCompletion.of(completion),
        userEvent: "input.complete",
      });
    },
  };
}

function completionResult(from: number, options: Completion[]): CompletionResult {
  return { from, options, validFor: /^[^\]\n]*$/ };
}

function resolveLinkTarget(app: App, query: string, sourcePath: string): TFile | null {
  if (query.length === 0) return app.vault.getFileByPath(sourcePath);
  return app.metadataCache.getFirstLinkpathDest(query, sourcePath);
}

function fileCompletion(
  app: App,
  file: TFile,
  sourcePath: string,
  linkStart: number,
  alias?: string,
): Completion {
  const parentPath = file.parent?.path;
  return {
    label: alias ?? file.basename,
    detail: alias
      ? `${file.path} · alias`
      : parentPath && parentPath !== "/" ? `${parentPath}/` : undefined,
    type: alias ? "property" : "text",
    apply: replaceWholeWikiLink(
      linkStart,
      () => app.fileManager.generateMarkdownLink(file, sourcePath, undefined, alias),
    ),
  };
}

function headingCompletions(
  app: App,
  file: TFile,
  sourcePath: string,
  linkStart: number,
): Completion[] {
  const headings = app.metadataCache.getFileCache(file)?.headings ?? [];
  return headings.map((heading) => headingCompletion(app, file, heading, sourcePath, linkStart));
}

function headingCompletion(
  app: App,
  file: TFile,
  heading: HeadingCache,
  sourcePath: string,
  linkStart: number,
): Completion {
  return {
    label: heading.heading,
    detail: file.path,
    type: "text",
    apply: replaceWholeWikiLink(
      linkStart,
      () => app.fileManager.generateMarkdownLink(file, sourcePath, `#${heading.heading}`),
    ),
  };
}

function blockCompletions(
  app: App,
  file: TFile,
  sourcePath: string,
  linkStart: number,
): Completion[] {
  const blocks = app.metadataCache.getFileCache(file)?.blocks ?? {};
  return Object.values(blocks).map((block) => ({
    label: block.id,
    detail: file.path,
    type: "text",
    apply: replaceWholeWikiLink(
      linkStart,
      () => app.fileManager.generateMarkdownLink(file, sourcePath, `#^${block.id}`),
    ),
  }));
}

function globalHeadingCompletions(app: App, sourcePath: string, linkStart: number): Completion[] {
  return app.vault.getMarkdownFiles().flatMap((file) => (
    headingCompletions(app, file, sourcePath, linkStart)
  ));
}

function globalBlockCompletions(app: App, sourcePath: string, linkStart: number): Completion[] {
  return app.vault.getMarkdownFiles().flatMap((file) => (
    blockCompletions(app, file, sourcePath, linkStart)
  ));
}

function replaceWholeWikiLink(
  linkStart: number,
  link: () => string,
): (view: EditorView, completion: Completion, from: number, to: number) => void {
  return (view, completion, _from, to) => {
    const replaceTo = view.state.sliceDoc(to, to + 2) === "]]" ? to + 2 : to;
    const insert = link();
    view.dispatch({
      changes: { from: linkStart, to: replaceTo, insert },
      selection: { anchor: linkStart + insert.length },
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
  };
}
