import type { Moment } from "moment";
import { dailyDateKey } from "./DailyWeek";

export type TimelineShiftDirection = -1 | 1;

export interface TimelineWindowShift {
  addedKeys: string[];
  removedKeys: string[];
}

const BATCH_DAYS = 7;
const INITIAL_RADIUS_DAYS = 7;

/**
 * A small, deterministic date window for the timeline. The view can move this
 * window forever while retaining a bounded number of rendered Daily Notes.
 */
export class DailyTimelineWindow {
  private start: Moment;
  private end: Moment;

  constructor(
    anchor: Moment,
    private readonly maximumDays: number,
  ) {
    this.start = anchor.clone().startOf("day").subtract(INITIAL_RADIUS_DAYS, "days");
    this.end = anchor.clone().startOf("day").add(INITIAL_RADIUS_DAYS, "days");
  }

  get keys(): string[] {
    const result: string[] = [];
    const cursor = this.start.clone();
    while (cursor.isSameOrBefore(this.end, "day")) {
      result.push(dailyDateKey(cursor));
      cursor.add(1, "day");
    }
    return result;
  }

  get firstKey(): string {
    return dailyDateKey(this.start);
  }

  get lastKey(): string {
    return dailyDateKey(this.end);
  }

  shift(direction: TimelineShiftDirection): TimelineWindowShift {
    const previousKeys = this.keys;
    if (direction < 0) this.start.subtract(BATCH_DAYS, "days");
    else this.end.add(BATCH_DAYS, "days");

    while (this.dayCount > this.maximumDays) {
      if (direction < 0) this.end.subtract(BATCH_DAYS, "days");
      else this.start.add(BATCH_DAYS, "days");
    }

    const nextKeys = this.keys;
    const previous = new Set(previousKeys);
    const next = new Set(nextKeys);
    return {
      addedKeys: nextKeys.filter((key) => !previous.has(key)),
      removedKeys: previousKeys.filter((key) => !next.has(key)),
    };
  }

  private get dayCount(): number {
    return this.end.diff(this.start, "days") + 1;
  }
}

export function timelineScrollDirection(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold: number,
): TimelineShiftDirection | 0 {
  if (scrollTop <= threshold) return -1;
  if (scrollTop + clientHeight >= scrollHeight - threshold) return 1;
  return 0;
}
