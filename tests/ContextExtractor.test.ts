import { describe, expect, it } from "vitest";
import { ContextExtractor } from "../src/backlinks/ContextExtractor";
import type { ContextProfile, ResolvedReference, SourceDocument } from "../src/types";
import { scanMarkdownSections } from "../src/utils/markdown";

const normal: ContextProfile = { neighborBlocks: 1, maxChars: 900 };
const compact: ContextProfile = { neighborBlocks: 0, maxChars: 400 };

describe("ContextExtractor", () => {
  it("includes the containing paragraph and one prose neighbor on each side", () => {
    const markdown = "Before.\n\nI love [[Target]] because of X.\n\nAfter.";
    const result = extract(markdown, [reference(markdown, "[[Target]]")], normal);
    expect(result).toHaveLength(1);
    expect(result[0]?.fullMarkdown).toContain("Before.");
    expect(result[0]?.fullMarkdown).toContain("I love [[Target]] because of X.");
    expect(result[0]?.fullMarkdown).toContain("After.");
  });

  it("compact mode returns only the containing block", () => {
    const markdown = "Before.\n\nI love [[Target]].\n\nAfter.";
    const result = extract(markdown, [reference(markdown, "[[Target]]")], compact);
    expect(result[0]?.fullMarkdown).toBe("I love [[Target]].");
  });

  it("stops at headings and reports the nearest heading", () => {
    const markdown = "Unrelated.\n\n## Film notes\n\nBefore.\n\n[[Target]] is excellent.\n\nAfter.\n\n## Other\n\nNo.";
    const document = makeDocument(markdown, [{ heading: "Film notes", marker: "## Film notes" }, { heading: "Other", marker: "## Other" }]);
    const result = new ContextExtractor().extract(document, [reference(markdown, "[[Target]]")], normal);
    expect(result[0]?.heading).toBe("Film notes");
    expect(result[0]?.fullMarkdown).not.toContain("Unrelated");
    expect(result[0]?.fullMarkdown).not.toContain("## Other");
  });

  it.each([
    "[[Target|visible name]]",
    "[[Target#Section]]",
    "[[Target#^abc123]]",
    "[visible](Target.md)",
  ])("keeps link syntax intact for %s", (token) => {
    const markdown = `A paragraph about ${token} in context.`;
    expect(extract(markdown, [reference(markdown, token)], compact)[0]?.markdown).toContain(token);
  });

  it("merges duplicate links whose contexts overlap", () => {
    const markdown = "[[Target]] does X, while [[Target|it]] also does Y.";
    const references = [reference(markdown, "[[Target]]"), reference(markdown, "[[Target|it]]")];
    const result = extract(markdown, references, normal);
    expect(result).toHaveLength(1);
    expect(result[0]?.references).toHaveLength(2);
    expect(result[0]?.linkOffsetsWithinExcerpt).toHaveLength(2);
  });

  it("keeps separate occurrences in different non-overlapping passages", () => {
    const markdown = "[[Target]] first.\n\n## Boundary\n\n[[Target]] second.";
    const refs = [reference(markdown, "[[Target]]"), reference(markdown, "[[Target]]", 0, 1)];
    expect(extract(markdown, refs, normal)).toHaveLength(2);
  });

  it("does not return fake links in YAML or code fences", () => {
    const markdown = "---\nlink: '[[Target]]'\n---\n\n```md\n[[Target]]\n```\n\nReal [[Target]].";
    const refs = [0, 1, 2].map((occurrence) => reference(markdown, "[[Target]]", 0, occurrence));
    const result = extract(markdown, refs, compact);
    expect(result).toHaveLength(1);
    expect(result[0]?.fullMarkdown).toBe("Real [[Target]].");
  });

  it("excludes percent and HTML comments", () => {
    const markdown = "%% [[Target]] %%\n\n<!-- [[Target]] -->\n\nVisible [[Target]].";
    const refs = [0, 1, 2].map((occurrence) => reference(markdown, "[[Target]]", 0, occurrence));
    const result = extract(markdown, refs, compact);
    expect(result).toHaveLength(1);
    expect(result[0]?.fullMarkdown).toContain("Visible");
  });

  it.each([
    "- A task about [[Target]]\n  - nested detail",
    "> A quote about [[Target]]\n> continues here",
    "> [!note]\n> A callout about [[Target]]",
    "| Subject | Thought |\n| --- | --- |\n| Film | [[Target]] |",
  ])("keeps structural block self-contained", (markdown) => {
    const result = extract(`${markdown}\n\nUnrelated after.`, [reference(markdown, "[[Target]]")], normal);
    expect(result[0]?.fullMarkdown).toContain("[[Target]]");
    expect(result[0]?.fullMarkdown).not.toContain("Unrelated after");
  });

  it("truncates a very long paragraph around the link and keeps the full form", () => {
    const markdown = `${"Before words. ".repeat(80)}[[Target]] ${"After words. ".repeat(80)}`;
    const result = extract(markdown, [reference(markdown, "[[Target]]")], { neighborBlocks: 0, maxChars: 300 });
    expect(result[0]?.truncated).toBe(true);
    expect(result[0]?.markdown.length).toBeLessThan(470);
    expect(result[0]?.markdown).toContain("[[Target]]");
    expect(result[0]?.fullMarkdown).toBe(markdown);
  });

  it.each([
    "[[Target]] begins the file.",
    "The file ends with [[Target]]",
    "Unicode café 日本語 [[Target]] 🚀 continues.",
    "Windows\r\n\r\nA thought about [[Target]].\r\n\r\nAfter.",
  ])("handles offsets in %j", (markdown) => {
    const result = extract(markdown, [reference(markdown, "[[Target]]")], normal);
    expect(result[0]?.markdown).toContain("[[Target]]");
  });
});

function extract(markdown: string, references: ResolvedReference[], profile: ContextProfile) {
  return new ContextExtractor().extract(makeDocument(markdown), references, profile);
}

function makeDocument(
  markdown: string,
  headingMarkers: Array<{ heading: string; marker: string }> = [],
): SourceDocument {
  return {
    markdown,
    sections: scanMarkdownSections(markdown),
    headings: headingMarkers.map(({ heading, marker }) => {
      const start = markdown.indexOf(marker);
      return {
        heading,
        level: 2,
        position: {
          start: { line: lineAt(markdown, start), col: 0, offset: start },
          end: { line: lineAt(markdown, start), col: marker.length, offset: start + marker.length },
        },
      };
    }),
    listItems: [],
  };
}

function reference(markdown: string, token: string, from = 0, occurrence = 0): ResolvedReference {
  let start = from;
  for (let index = 0; index <= occurrence; index += 1) start = markdown.indexOf(token, index === 0 ? start : start + token.length);
  if (start < 0) throw new Error(`Missing token ${token}`);
  const before = markdown.slice(0, start);
  const line = before.split(/\r?\n/).length - 1;
  const lastBreak = Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
  return {
    targetPath: "Target.md",
    sourcePath: "Source.md",
    startOffset: start,
    endOffset: start + token.length,
    startLine: line,
    startColumn: start - lastBreak - 1,
    endLine: line,
    endColumn: start - lastBreak - 1 + token.length,
    original: token,
    linkText: "Target",
    isEmbed: false,
    occurrenceIndex: occurrence,
  };
}

function lineAt(markdown: string, offset: number): number {
  return markdown.slice(0, offset).split(/\r?\n/).length - 1;
}
