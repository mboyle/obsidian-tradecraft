import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("mobile navigator styles", () => {
  it("shows the week strip only on mobile or narrow layouts", () => {
    expect(styles).toMatch(
      /@media \(min-width: 701px\)\s*\{[\s\S]*?body:not\(\.is-mobile\)[^{]*\.dossier-week-nav\s*\{\s*display:\s*none;/,
    );
  });

  it("outranks Obsidian's Markdown padding reset and clears the native header", () => {
    expect(styles).toContain(
      'body.is-mobile .workspace-leaf-content[data-type="markdown"] .view-content.dossier-week-nav-host',
    );
    expect(styles).toMatch(
      /padding-block-start:\s*calc\(\s*var\(--safe-area-inset-top, 0px\) \+ var\(--view-header-height, 50px\)\s*\)/,
    );
  });

  it("keeps iOS weekday glyphs visible and tightens note spacing", () => {
    expect(styles).toMatch(
      /\.dossier-week-nav-weekday\s*\{[^}]*overflow:\s*visible;[^}]*color:\s*var\(--text-faint\);[^}]*font-size:\s*calc\(var\(--font-ui-smaller\) \* 0\.8\);[^}]*font-weight:\s*300;[^}]*line-height:\s*1;/s,
    );
    expect(styles).toMatch(
      /\.dossier-week-nav-host\s*>\s*\.markdown-source-view\s*>\s*\.cm-editor\s*>\s*\.cm-scroller\s*\{\s*padding-block-start:\s*var\(--size-4-2\);/s,
    );
  });

  it("hides backlink separators while the reference section is empty", () => {
    expect(styles).toMatch(/\.dossier-backlinks\.is-empty\s*\{\s*display:\s*none;/);
    expect(styles).toMatch(
      /\.dossier-backlinks:not\(:empty\):not\(\.is-empty\)\s*\{[^}]*border-block-start:/s,
    );
    expect(styles).not.toMatch(/\.dossier-backlinks\s*\{[^}]*border-block-start:/s);
  });

  it("does not add space above the month heading", () => {
    expect(styles).toMatch(/\.dossier-week-nav\s*\{[^}]*padding-block:\s*0 0\.15rem;/s);
    expect(styles).toMatch(
      /\.dossier-week-nav-month\s*\{[^}]*min-height:\s*0;[^}]*height:\s*auto;[^}]*margin:\s*0 auto 8px;[^}]*padding:\s*0;/s,
    );
  });

  it("keeps the week strip visually compact", () => {
    expect(styles).toMatch(
      /\.dossier-week-nav-date\s*\{[^}]*gap:\s*2px;[^}]*min-height:\s*2\.35rem;[^}]*padding:\s*0\.05rem 0 0\.18rem;/s,
    );
    expect(styles).toMatch(
      /\.dossier-week-nav-day\s*\{[^}]*min-width:\s*1\.55rem;[^}]*min-height:\s*1\.55rem;/s,
    );
    expect(styles).toMatch(
      /\.dossier-week-nav-indicators\s*\{[^}]*position:\s*absolute;[^}]*inset-block-end:\s*0;/s,
    );
  });

  it("replaces the backing Markdown surface while a missing date is still unsaved", () => {
    expect(styles).toMatch(
      /\.view-content\.dossier-week-nav-host\.has-dossier-deferred-daily\s*>\s*:is\(\.markdown-source-view, \.markdown-reading-view\)\s*\{\s*display:\s*none;/s,
    );
    expect(styles).toMatch(/\.dossier-deferred-daily\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(styles).toMatch(
      /\.dossier-deferred-daily\s*\{[^}]*padding:\s*var\(--file-margins\);[^}]*box-sizing:\s*border-box;/s,
    );
    expect(styles).toMatch(
      /\.dossier-deferred-daily-content\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*var\(--file-line-width\);[^}]*margin-inline:\s*auto;/s,
    );
    expect(styles).toMatch(
      /\.dossier-deferred-daily-title\s*\{[^}]*transform:\s*translateY\(10px\);/s,
    );
    expect(styles).toMatch(
      /\.dossier-timeline-editor \.dossier-timeline-lp-bullet\s*\{[^}]*transform:\s*translate\(4px, 0\.75px\);/s,
    );
  });

  it("avoids costly selectors and forced cascade overrides", () => {
    expect(styles).not.toContain(":has(");
    expect(styles).not.toContain("!important");
    expect(styles).not.toMatch(/text-decoration-(?:color|thickness)\s*:/);
  });
});
