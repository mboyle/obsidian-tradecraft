import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("linked reference styles", () => {
  it("keeps the reference surface smaller and tighter than note content", () => {
    expect(styles).toMatch(
      /\.dossier-backlinks\s*\{[^}]*font-size:\s*0\.88em;[^}]*line-height:\s*1\.45;/s,
    );
    expect(styles).toMatch(
      /\.dossier-backlinks-body\s*\{[^}]*margin-block-start:\s*0\.55rem;/s,
    );
    expect(styles).toMatch(
      /\.dossier-backlink-group \+ \.dossier-backlink-group\s*\{[^}]*margin-block-start:\s*0\.9rem;[^}]*padding-block-start:\s*0\.8rem;/s,
    );
  });

  it("uses compact Reflect-like source links and outline indentation", () => {
    expect(styles).toMatch(
      /\.dossier-backlink-source\s*\{[^}]*color:\s*var\(--text-accent\);[^}]*font-size:\s*1em;[^}]*font-weight:\s*var\(--font-normal\);/s,
    );
    expect(styles).toMatch(
      /\.dossier-backlinks \.dossier-backlink-context > :is\(ul, ol\)\s*\{[^}]*padding-inline-start:\s*var\(--dossier-reference-outer-indent\);/s,
    );
    expect(styles).toMatch(
      /\.dossier-backlinks \.dossier-backlink-context :is\(ul, ol\) :is\(ul, ol\)\s*\{[^}]*padding-inline-start:\s*var\(--dossier-reference-nested-indent\);/s,
    );
    expect(styles).toMatch(
      /\.dossier-backlink-context \.dossier-backlink-current-link\s*\{[^}]*font-weight:\s*inherit;[^}]*text-decoration:\s*none;/s,
    );
  });

  it("does not re-expand source rows on mobile", () => {
    expect(styles).toMatch(
      /@media \(max-width: 600px\)[\s\S]*\.dossier-backlinks-header,\s*\.dossier-backlink-source\s*\{\s*min-height:\s*1\.75rem;/,
    );
  });

  it("removes source carets and minimizes reference indentation on mobile", () => {
    expect(styles).toMatch(
      /@media \(max-width: 600px\)[\s\S]*\.dossier-backlinks\s*\{[^}]*--dossier-reference-outer-indent:\s*0\.2em;[^}]*--dossier-reference-nested-indent:\s*0\.7em;/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 600px\)[\s\S]*\.dossier-backlink-source::before\s*\{\s*display:\s*none;/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 600px\)[\s\S]*\.dossier-backlink-context-heading\s*\{\s*padding-inline-start:\s*0;/,
    );
  });
});
