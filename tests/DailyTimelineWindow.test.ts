import { describe, expect, it } from "vitest";
import { moment } from "obsidian";
import {
  DailyTimelineWindow,
  timelineScrollDirection,
} from "../src/dailyDates/DailyTimelineWindow";

describe("DailyTimelineWindow", () => {
  it("starts around the selected date and grows in seven-day batches", () => {
    const window = new DailyTimelineWindow(moment("2026-08-20"), 35);
    expect(window.keys).toHaveLength(15);
    expect(window.firstKey).toBe("2026-08-13");
    expect(window.lastKey).toBe("2026-08-27");

    const earlier = window.shift(-1);
    expect(earlier.addedKeys).toEqual([
      "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09",
      "2026-08-10", "2026-08-11", "2026-08-12",
    ]);
    expect(earlier.removedKeys).toEqual([]);
    expect(window.keys).toHaveLength(22);
  });

  it("remains bounded while scrolling indefinitely in either direction", () => {
    const window = new DailyTimelineWindow(moment("2026-08-20"), 35);
    for (let index = 0; index < 20; index += 1) window.shift(1);
    expect(window.keys).toHaveLength(29);
    expect(window.lastKey).toBe("2027-01-14");

    const before = window.keys;
    const shift = window.shift(-1);
    expect(shift.addedKeys).toHaveLength(7);
    expect(shift.removedKeys).toHaveLength(7);
    expect(window.keys).toHaveLength(before.length);
  });

  it("handles leap days and year boundaries as calendar dates", () => {
    const window = new DailyTimelineWindow(moment("2024-02-29"), 21);
    expect(window.keys).toContain("2024-02-29");
    for (let index = 0; index < 45; index += 1) window.shift(-1);
    expect(window.keys.every((key) => moment(key, "YYYY-MM-DD", true).isValid())).toBe(true);
  });
});

describe("timelineScrollDirection", () => {
  it("requests more dates only near the top or bottom threshold", () => {
    expect(timelineScrollDirection(0, 800, 5000, 720)).toBe(-1);
    expect(timelineScrollDirection(1500, 800, 5000, 720)).toBe(0);
    expect(timelineScrollDirection(3500, 800, 5000, 720)).toBe(1);
  });
});
