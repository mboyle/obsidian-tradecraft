export interface TimelineEditIntent {
  renderedText: string;
  characterOffset: number;
  blockOrdinal: number;
  sourceLine?: number;
  clientX?: number;
  blockOffsetY?: number;
}

interface SourceLineCandidate {
  from: number;
  prefixLength: number;
  rawContent: string;
  renderedText: string;
  ordinal: number;
  lineNumber: number;
}

/** Maps a click in rendered Markdown back to the most likely source position. */
export function findTimelineEditOffset(markdown: string, intent: TimelineEditIntent): number {
  const candidates = sourceCandidates(markdown);
  if (candidates.length === 0) return markdown.length;

  const explicit = intent.sourceLine === undefined
    ? undefined
    : candidates.find((candidate) => candidate.lineNumber === intent.sourceLine);
  const target = explicit ?? bestCandidate(candidates, intent);
  if (!target) return markdown.length;

  const requested = Math.max(0, intent.characterOffset);
  return Math.min(
    target.from + target.prefixLength + target.rawContent.length,
    target.from + target.prefixLength + requested,
  );
}

function sourceCandidates(markdown: string): SourceLineCandidate[] {
  const candidates: SourceLineCandidate[] = [];
  let from = 0;
  let ordinal = 0;
  const lines = markdown.split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber] ?? "";
    if (line.trim().length > 0) {
      const prefixLength = markdownPrefixLength(line);
      const rawContent = line.slice(prefixLength);
      candidates.push({
        from,
        prefixLength,
        rawContent,
        renderedText: normalizeRenderedText(markdownInlineText(rawContent)),
        ordinal,
        lineNumber,
      });
      ordinal += 1;
    }
    from += line.length + (markdown.slice(from + line.length, from + line.length + 2) === "\r\n" ? 2 : 1);
  }
  return candidates;
}

function bestCandidate(
  candidates: SourceLineCandidate[],
  intent: TimelineEditIntent,
): SourceLineCandidate | undefined {
  const rendered = normalizeRenderedText(intent.renderedText);
  let best: SourceLineCandidate | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const candidateText = candidate.renderedText;
    let textScore = 0;
    if (rendered && candidateText === rendered) textScore = 1000;
    else if (rendered && (rendered.startsWith(candidateText) || candidateText.startsWith(rendered))) textScore = 700;
    else if (rendered && (rendered.includes(candidateText) || candidateText.includes(rendered))) textScore = 400;
    else if (rendered) textScore = sharedPrefixLength(rendered, candidateText);
    const score = textScore - Math.abs(candidate.ordinal - intent.blockOrdinal) * 2;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function markdownPrefixLength(line: string): number {
  const match = /^(\s*(?:(?:#{1,6}|>|[-+*]|\d+[.)])\s+)(?:\[[ xX]\]\s+)?)/.exec(line);
  return match?.[0].length ?? line.length - line.trimStart().length;
}

function markdownInlineText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/(?:\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, "$1");
}

function normalizeRenderedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function sharedPrefixLength(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) index += 1;
  return index;
}
