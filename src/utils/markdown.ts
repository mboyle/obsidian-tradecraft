import type { SectionCache } from "obsidian";

interface LineInfo {
  text: string;
  start: number;
  end: number;
  line: number;
}

/** A deliberately small fallback. Obsidian's SectionCache remains the primary parser. */
export function scanMarkdownSections(markdown: string): SectionCache[] {
  const lines = getLines(markdown);
  const sections: SectionCache[] = [];
  let index = 0;
  let inFence = false;
  let fenceStart = 0;
  let fenceMarker = "";

  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    if (line.text.trim() === "") {
      index += 1;
      continue;
    }

    if (index === 0 && /^---\s*$/.test(line.text)) {
      const endIndex = findClosingLine(lines, index + 1, /^---\s*$/);
      const last = lines[endIndex] ?? line;
      sections.push(makeSection("yaml", line, last));
      index = endIndex + 1;
      continue;
    }

    const fence = /^\s*(```+|~~~+)/.exec(line.text);
    if (fence) {
      inFence = true;
      fenceStart = index;
      fenceMarker = fence[1]?.[0] ?? "`";
      let endIndex = index + 1;
      while (endIndex < lines.length && !new RegExp(`^\\s*${escapeRegExp(fenceMarker)}{3,}`).test(lines[endIndex]?.text ?? "")) {
        endIndex += 1;
      }
      const last = lines[Math.min(endIndex, lines.length - 1)] ?? line;
      sections.push(makeSection("code", lines[fenceStart] ?? line, last));
      index = endIndex + 1;
      inFence = false;
      continue;
    }
    if (inFence) {
      index += 1;
      continue;
    }

    const singleType = classifySingleLine(line.text, lines[index + 1]?.text);
    if (singleType) {
      sections.push(makeSection(singleType, line, line));
      index += 1;
      continue;
    }

    const start = index;
    const family = blockFamily(line.text);
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (!next || next.text.trim() === "" || classifySingleLine(next.text, lines[index + 1]?.text)) break;
      if (blockFamily(next.text) !== family && family !== "paragraph") break;
      index += 1;
    }
    sections.push(makeSection(family, lines[start] ?? line, lines[index - 1] ?? line));
  }
  return sections;
}

function getLines(markdown: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let offset = 0;
  const rawLines = markdown.split(/\r?\n/);
  for (let line = 0; line < rawLines.length; line += 1) {
    const text = rawLines[line] ?? "";
    const endingLength = markdown.slice(offset + text.length, offset + text.length + 2) === "\r\n" ? 2 : line < rawLines.length - 1 ? 1 : 0;
    lines.push({ text, start: offset, end: offset + text.length, line });
    offset += text.length + endingLength;
  }
  return lines;
}

function classifySingleLine(text: string, next?: string): string | undefined {
  if (/^\s{0,3}#{1,6}\s+/.test(text) || (next !== undefined && /^\s*(=+|-+)\s*$/.test(next) && text.trim())) return "heading";
  if (/^\s{0,3}((\*|-|_)\s*){3,}$/.test(text)) return "thematicBreak";
  return undefined;
}

function blockFamily(text: string): string {
  if (/^\s*>\s*\[![^\]]+\]/.test(text)) return "callout";
  if (/^\s*>/.test(text)) return "blockquote";
  if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(text)) return "list";
  if (/^\s*\|.*\|\s*$/.test(text)) return "table";
  return "paragraph";
}

function makeSection(type: string, first: LineInfo, last: LineInfo): SectionCache {
  return {
    type,
    position: {
      start: { line: first.line, col: 0, offset: first.start },
      end: { line: last.line, col: last.text.length, offset: last.end },
    },
  };
}

function findClosingLine(lines: LineInfo[], from: number, pattern: RegExp): number {
  for (let index = from; index < lines.length; index += 1) {
    if (pattern.test(lines[index]?.text ?? "")) return index;
  }
  return Math.max(from - 1, lines.length - 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
