import { describe, expect, it } from "vitest";
import { moment } from "obsidian";
import {
  dailyDateFromKey,
  dailyDateKey,
  dailyWeekDates,
  decideWeekSwipe,
  isSwipeStartAllowed,
  isDateInWeek,
  monthForDisplayedWeek,
  startOfDailyWeek,
  swipeIntent,
} from "../src/dailyDates/DailyWeek";

describe("Daily Note weeks", () => {
  it("starts weeks on Monday or Sunday across month and year boundaries", () => {
    const newYear = moment("2027-01-01", "YYYY-MM-DD", true);
    expect(dailyDateKey(startOfDailyWeek(newYear, "monday"))).toBe("2026-12-28");
    expect(dailyDateKey(startOfDailyWeek(newYear, "sunday"))).toBe("2026-12-27");
    expect(dailyWeekDates(startOfDailyWeek(newYear, "monday")).map(dailyDateKey)).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31",
      "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
  });

  it("round-trips leap days and rejects invalid canonical keys", () => {
    const leap = dailyDateFromKey("2028-02-29");
    expect(leap && dailyDateKey(leap)).toBe("2028-02-29");
    expect(dailyDateFromKey("2027-02-29")).toBeNull();
    expect(dailyDateFromKey("2026-8-20")).toBeNull();
  });

  it("uses the selected month in its week and the fourth day when offscreen", () => {
    const visible = moment("2026-08-31", "YYYY-MM-DD", true);
    expect(monthForDisplayedWeek(moment("2026-09-01"), visible).format("MMMM YYYY"))
      .toBe("September 2026");
    expect(monthForDisplayedWeek(moment("2026-10-20"), visible).format("MMMM YYYY"))
      .toBe("September 2026");
    expect(isDateInWeek(moment("2026-09-06"), visible)).toBe(true);
    expect(isDateInWeek(moment("2026-09-07"), visible)).toBe(false);
  });

  it("keeps calendar keys stable through a DST transition", () => {
    const start = moment("2026-03-07", "YYYY-MM-DD", true);
    expect(dailyWeekDates(start).map(dailyDateKey)).toEqual([
      "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10",
      "2026-03-11", "2026-03-12", "2026-03-13",
    ]);
  });
});

describe("week swipe decisions", () => {
  it("respects the direction dead zone and iOS edge exclusion", () => {
    expect(swipeIntent(9, 1)).toBe("pending");
    expect(swipeIntent(11, 4)).toBe("horizontal");
    expect(swipeIntent(4, 11)).toBe("vertical");
    expect(isSwipeStartAllowed(20, 320)).toBe(false);
    expect(isSwipeStartAllowed(21, 320)).toBe(true);
    expect(isSwipeStartAllowed(300, 320)).toBe(false);
    expect(isSwipeStartAllowed(299, 320)).toBe(true);
  });

  it("commits by distance or velocity and never commits a vertical gesture", () => {
    expect(decideWeekSwipe({ deltaX: -80, deltaY: 2, width: 300, elapsedMs: 500 })).toBe(1);
    expect(decideWeekSwipe({ deltaX: 25, deltaY: 2, width: 300, elapsedMs: 40 })).toBe(-1);
    expect(decideWeekSwipe({ deltaX: 25, deltaY: 2, width: 300, elapsedMs: 500 })).toBe(0);
    expect(decideWeekSwipe({ deltaX: 100, deltaY: 120, width: 300, elapsedMs: 100 })).toBe(0);
    expect(decideWeekSwipe({ deltaX: 100, deltaY: 0, width: 0, elapsedMs: 10 })).toBe(0);
  });
});
