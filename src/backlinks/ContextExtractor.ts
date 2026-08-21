import type { ContextProfile, ExtractedContext, ResolvedReference, SourceDocument, SourceRange } from "../types";
import { scanMarkdownSections } from "../utils/markdown";
import { overlapRatio } from "../utils/ranges";

interface Block {
  type: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}

interface Candidate {
  range: SourceRange;
  references: ResolvedReference[];
  heading?: string;
}

const HARD_BOUNDARIES = new Set([
  "heading",
  "thematicBreak",
  "code",
  "yaml",
  "html",
  "table",
  "callout",
  "footnoteDefinition",
]);

const SELF_CONTAINED = new Set(["list", "table", "callout", "blockquote"]);

export class ContextExtractor {
  extract(
    document: SourceDocument,
    references: ResolvedReference[],
    profile: ContextProfile,
  ): Array<ExtractedContext & { references: ResolvedReference[] }> {
    const blocks = this.blocksFor(document);
    const candidates: Candidate[] = [];

    for (const reference of references) {
      if (isInsideComment(document.markdown, reference.startOffset)) continue;
      const containingIndex = blocks.findIndex(
        (block) => reference.startOffset >= block.start && reference.startOffset <= block.end,
      );
      if (containingIndex < 0) continue;
      const containing = this.refineContainingBlock(document, blocks[containingIndex]!, reference);
      if (["yaml", "code", "html"].includes(containing.type)) continue;
      const range = this.selectRange(blocks, containingIndex, containing, profile.neighborBlocks, profile.maxChars);
      candidates.push({
        range,
        references: [reference],
        heading: nearestHeading(document, reference.startOffset),
      });
    }

    return this.mergeCandidates(candidates).map((candidate) => ({
      ...this.materialize(document.markdown, candidate, profile.maxChars),
      references: candidate.references,
    }));
  }

  private blocksFor(document: SourceDocument): Block[] {
    const sections = document.sections.length > 0 ? document.sections : scanMarkdownSections(document.markdown);
    return sections
      .map((section) => ({
        type: section.type,
        start: section.position.start.offset,
        end: section.position.end.offset,
        startLine: section.position.start.line,
        endLine: section.position.end.line,
      }))
      .filter((block) => block.end >= block.start)
      .sort((a, b) => a.start - b.start);
  }

  private refineContainingBlock(
    document: SourceDocument,
    containing: Block,
    reference: ResolvedReference,
  ): Block {
    if (containing.type !== "list") return containing;
    const item = document.listItems
      .filter(
        (candidate) =>
          reference.startOffset >= candidate.position.start.offset && reference.startOffset <= candidate.position.end.offset,
      )
      .sort(
        (a, b) =>
          a.position.end.offset - a.position.start.offset - (b.position.end.offset - b.position.start.offset),
      )[0];
    if (!item) return containing;
    const byLine = new Map(document.listItems.map((candidate) => [candidate.position.start.line, candidate]));
    let root = item;
    const visited = new Set<number>();
    while (root.parent >= 0 && !visited.has(root.parent)) {
      visited.add(root.parent);
      const parent = byLine.get(root.parent);
      if (!parent) break;
      root = parent;
    }
    const descendants = document.listItems.filter((candidate) => isDescendantOf(candidate, root, byLine));
    const endItem = descendants.sort((a, b) => b.position.end.offset - a.position.end.offset)[0] ?? root;
    return {
      type: "list",
      start: root.position.start.offset,
      end: endItem.position.end.offset,
      startLine: root.position.start.line,
      endLine: endItem.position.end.line,
    };
  }

  private selectRange(
    blocks: Block[],
    containingIndex: number,
    containing: Block,
    neighborBlocks: number,
    maxChars: number,
  ): SourceRange {
    if (neighborBlocks === 0 || SELF_CONTAINED.has(containing.type)) {
      return { start: containing.start, end: containing.end };
    }

    const selected: Block[] = [containing];
    for (const direction of [-1, 1] as const) {
      let added = 0;
      let cursor = containingIndex + direction;
      while (cursor >= 0 && cursor < blocks.length && added < neighborBlocks) {
        const block = blocks[cursor];
        if (!block || HARD_BOUNDARIES.has(block.type) || SELF_CONTAINED.has(block.type)) break;
        selected.push(block);
        added += 1;
        cursor += direction;
      }
    }

    selected.sort((a, b) => a.start - b.start);
    while (selected.length > 1 && selected[selected.length - 1]!.end - selected[0]!.start > maxChars) {
      const first = selected[0]!;
      const last = selected[selected.length - 1]!;
      const containingCenter = (containing.start + containing.end) / 2;
      const firstDistance = Math.abs((first.start + first.end) / 2 - containingCenter);
      const lastDistance = Math.abs((last.start + last.end) / 2 - containingCenter);
      if (lastDistance >= firstDistance && last !== containing) selected.pop();
      else if (first !== containing) selected.shift();
      else selected.pop();
    }
    return { start: selected[0]!.start, end: selected[selected.length - 1]!.end };
  }

  private mergeCandidates(candidates: Candidate[]): Candidate[] {
    const sorted = [...candidates].sort((a, b) => a.range.start - b.range.start);
    const merged: Candidate[] = [];
    for (const candidate of sorted) {
      const previous = merged[merged.length - 1];
      if (previous && overlapRatio(previous.range, candidate.range) > 0.7) {
        previous.range = {
          start: Math.min(previous.range.start, candidate.range.start),
          end: Math.max(previous.range.end, candidate.range.end),
        };
        previous.references.push(...candidate.references);
      } else {
        merged.push({ ...candidate, references: [...candidate.references] });
      }
    }
    return merged;
  }

  private materialize(markdown: string, candidate: Candidate, maxChars: number): ExtractedContext {
    const fullMarkdown = markdown.slice(candidate.range.start, candidate.range.end);
    const truncated = truncateAroundReferences(fullMarkdown, candidate.range.start, candidate.references, maxChars);
    const linkOffsetsWithinExcerpt = candidate.references
      .map((reference) => ({
        start: reference.startOffset - candidate.range.start - truncated.sliceStart + truncated.prefixLength,
        end: reference.endOffset - candidate.range.start - truncated.sliceStart + truncated.prefixLength,
      }))
      .filter((range) => range.start >= 0 && range.end <= truncated.markdown.length);

    return {
      markdown: truncated.markdown,
      fullMarkdown,
      startOffset: candidate.range.start,
      endOffset: candidate.range.end,
      linkOffsetsWithinExcerpt,
      truncated: truncated.truncated,
      heading: candidate.heading,
    };
  }
}

function isDescendantOf(
  candidate: SourceDocument["listItems"][number],
  root: SourceDocument["listItems"][number],
  byLine: Map<number, SourceDocument["listItems"][number]>,
): boolean {
  if (candidate.position.start.line === root.position.start.line) return true;
  let cursor = candidate;
  const visited = new Set<number>();
  while (cursor.parent >= 0 && !visited.has(cursor.parent)) {
    if (cursor.parent === root.position.start.line) return true;
    visited.add(cursor.parent);
    const parent = byLine.get(cursor.parent);
    if (!parent) return false;
    cursor = parent;
  }
  return false;
}

function nearestHeading(document: SourceDocument, offset: number): string | undefined {
  return [...document.headings]
    .filter((heading) => heading.position.start.offset < offset)
    .sort((a, b) => b.position.start.offset - a.position.start.offset)[0]?.heading;
}

function truncateAroundReferences(
  markdown: string,
  absoluteStart: number,
  references: ResolvedReference[],
  maxChars: number,
): { markdown: string; truncated: boolean; sliceStart: number; prefixLength: number } {
  if (markdown.length <= maxChars) return { markdown, truncated: false, sliceStart: 0, prefixLength: 0 };
  const firstLink = Math.min(...references.map((reference) => reference.startOffset - absoluteStart));
  const lastLink = Math.max(...references.map((reference) => reference.endOffset - absoluteStart));
  const linkSpan = lastLink - firstLink;
  // Keep every target link visible, even when distant links require a larger-than-normal window.
  const effectiveMax = Math.max(maxChars, linkSpan + 80);
  const remaining = effectiveMax - linkSpan;
  let start = Math.max(0, firstLink - Math.floor(remaining / 2));
  let end = Math.min(markdown.length, lastLink + Math.ceil(remaining / 2));
  if (end - start < effectiveMax) {
    start = Math.max(0, end - effectiveMax);
    end = Math.min(markdown.length, start + effectiveMax);
  }
  start = seekBoundary(markdown, start, -1);
  end = seekBoundary(markdown, end, 1);

  const prefix = start > 0 ? "… " : "";
  const suffix = end < markdown.length ? " …" : "";
  return {
    markdown: `${prefix}${markdown.slice(start, end).trim()}${suffix}`,
    truncated: true,
    sliceStart: start,
    prefixLength: prefix.length,
  };
}

function seekBoundary(markdown: string, offset: number, direction: -1 | 1): number {
  let cursor = offset;
  const limit = direction < 0 ? Math.max(0, offset - 80) : Math.min(markdown.length, offset + 80);
  while (cursor !== limit) {
    const character = markdown[cursor];
    if (character === "\n" || character === " " || character === "." || character === "!" || character === "?") {
      return character === " " ? cursor + (direction > 0 ? 0 : 1) : cursor + (direction > 0 ? 1 : 0);
    }
    cursor += direction;
  }
  return offset;
}

function isInsideComment(markdown: string, offset: number): boolean {
  return insideDelimitedComment(markdown, offset, "%%", "%%") || insideDelimitedComment(markdown, offset, "<!--", "-->");
}

function insideDelimitedComment(markdown: string, offset: number, open: string, close: string): boolean {
  if (open === close) {
    let count = 0;
    let cursor = 0;
    while (cursor < offset) {
      const found = markdown.indexOf(open, cursor);
      if (found < 0 || found >= offset) break;
      count += 1;
      cursor = found + open.length;
    }
    return count % 2 === 1 && markdown.indexOf(close, offset) >= offset;
  }
  const lastOpen = markdown.lastIndexOf(open, offset);
  if (lastOpen < 0) return false;
  const lastClose = markdown.lastIndexOf(close, offset);
  return lastOpen > lastClose && markdown.indexOf(close, offset) >= offset;
}
