import { describe, expect, it } from "vitest";
import {
  dailyContentForEditing,
  dailyContentForPersistence,
  hasMeaningfulDeferredDailyContent,
} from "../src/dailyDates/DeferredDailyNote";

describe("deferred Daily Note content", () => {
  it.each([
    "",
    "   \n",
    "- ",
    "* ",
    "+ ",
    "1. ",
    "- [ ] ",
  ])("keeps placeholder-only content in memory: %j", (content) => {
    expect(hasMeaningfulDeferredDailyContent(content)).toBe(false);
  });

  it.each([
    "- First thought",
    "plain text",
    "- [x] Finished",
    "# Heading",
    "1. First item",
  ])("materializes content after meaningful input: %j", (content) => {
    expect(hasMeaningfulDeferredDailyContent(content)).toBe(true);
  });

  it("projects empty persisted notes as virtual starters and strips starters before saving", () => {
    expect(dailyContentForEditing("")).toBe("- ");
    expect(dailyContentForEditing("  \n\t")).toBe("- ");
    expect(dailyContentForEditing("- Real note")).toBe("- Real note");

    expect(dailyContentForPersistence("- ")).toBe("");
    expect(dailyContentForPersistence("  -   \n")).toBe("");
    expect(dailyContentForPersistence("- Real note")).toBe("- Real note");
  });
});
