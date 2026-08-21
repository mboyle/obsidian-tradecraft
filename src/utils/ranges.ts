import type { SourceRange } from "../types";

export function intersectionLength(a: SourceRange, b: SourceRange): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export function overlapRatio(a: SourceRange, b: SourceRange): number {
  const denominator = Math.min(a.end - a.start, b.end - b.start);
  return denominator <= 0 ? 0 : intersectionLength(a, b) / denominator;
}

export function containsOffset(range: SourceRange, offset: number): boolean {
  return offset >= range.start && offset <= range.end;
}
