// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  linkForPastedUrl,
  markdownFromHtml,
} from "../src/dailyDates/TimelinePasteDrop";

describe("timeline rich paste", () => {
  it("wraps a selected label when a URL is pasted", () => {
    expect(linkForPastedUrl("Dossier", "https://example.com/docs")).toBe(
      "[Dossier](https://example.com/docs)",
    );
    expect(linkForPastedUrl("", "https://example.com")).toBeNull();
    expect(linkForPastedUrl("Dossier", "ordinary text")).toBeNull();
  });

  it("converts rich clipboard HTML to Markdown", () => {
    expect(markdownFromHtml("<p><strong>Bold</strong> and <a href='https://example.com'>linked</a></p>")).toBe(
      "**Bold** and [linked](https://example.com)",
    );
  });
});
