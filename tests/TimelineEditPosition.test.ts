import { describe, expect, it } from "vitest";
import { findTimelineEditOffset } from "../src/dailyDates/TimelineEditPosition";

describe("timeline rendered-click position mapping", () => {
  it("lands in the clicked nested list item and preserves its source prefix", () => {
    const markdown = "- First\n  - Nested target\n- Last";
    expect(findTimelineEditOffset(markdown, {
      renderedText: "Nested target",
      characterOffset: 7,
      blockOrdinal: 1,
    })).toBe(markdown.indexOf("Nested target") + 7);
  });

  it("uses rendered block order to distinguish duplicate lines", () => {
    const markdown = "- Repeat\n- Between\n- Repeat";
    expect(findTimelineEditOffset(markdown, {
      renderedText: "Repeat",
      characterOffset: 6,
      blockOrdinal: 2,
    })).toBe(markdown.lastIndexOf("Repeat") + 6);
  });

  it("honors an explicit source line and handles CRLF offsets", () => {
    const markdown = "Intro\r\n- Target line\r\nOutro";
    expect(findTimelineEditOffset(markdown, {
      renderedText: "Target line",
      characterOffset: 3,
      blockOrdinal: 0,
      sourceLine: 1,
    })).toBe(markdown.indexOf("Target line") + 3);
  });

  it("maps formatted rendered text into the source content", () => {
    const markdown = "- **Bold words**";
    const offset = findTimelineEditOffset(markdown, {
      renderedText: "Bold words",
      characterOffset: 4,
      blockOrdinal: 0,
    });
    expect(offset).toBe(markdown.indexOf("**Bold words") + 4);
  });
});
