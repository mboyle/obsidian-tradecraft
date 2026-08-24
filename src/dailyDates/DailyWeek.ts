import { moment } from "obsidian";
import type { DailyNoteWeekStart } from "../types";

type Moment = moment.Moment;

export const DAILY_DATE_KEY_FORMAT = "YYYY-MM-DD";

export function dailyDateKey(date: Moment): string {
  return date.clone().format(DAILY_DATE_KEY_FORMAT);
}

export function dailyDateFromKey(key: string): Moment | null {
  const parsed = moment(key, DAILY_DATE_KEY_FORMAT, true);
  return parsed.isValid() ? parsed.startOf("day") : null;
}

export function startOfDailyWeek(date: Moment, weekStart: DailyNoteWeekStart): Moment {
  const startDay = weekStart === "sunday" ? 0 : 1;
  const offset = (date.day() - startDay + 7) % 7;
  return date.clone().startOf("day").subtract(offset, "days");
}

export function dailyWeekDates(start: Moment): Moment[] {
  return Array.from({ length: 7 }, (_, index) => start.clone().add(index, "days"));
}

export function isDateInWeek(date: Moment, start: Moment): boolean {
  const key = dailyDateKey(date);
  const startKey = dailyDateKey(start);
  const endKey = dailyDateKey(start.clone().add(6, "days"));
  return key >= startKey && key <= endKey;
}

export function monthForDisplayedWeek(selected: Moment, visibleStart: Moment): Moment {
  return isDateInWeek(selected, visibleStart) ? selected.clone() : visibleStart.clone().add(3, "days");
}

export interface SwipeDecisionInput {
  deltaX: number;
  deltaY: number;
  width: number;
  elapsedMs: number;
  distanceThreshold?: number;
  velocityThreshold?: number;
}

export type SwipeDirection = -1 | 0 | 1;
export type SwipeIntent = "pending" | "horizontal" | "vertical";

export function swipeIntent(deltaX: number, deltaY: number, deadZone = 10): SwipeIntent {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < deadZone) return "pending";
  return Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
}

export function isSwipeStartAllowed(offsetX: number, width: number, edgeExclusion = 20): boolean {
  return width > edgeExclusion * 2
    && offsetX > edgeExclusion
    && width - offsetX > edgeExclusion;
}

export function decideWeekSwipe(input: SwipeDecisionInput): SwipeDirection {
  const distanceThreshold = input.distanceThreshold ?? 0.25;
  const velocityThreshold = input.velocityThreshold ?? 0.45;
  const horizontal = Math.abs(input.deltaX);
  if (input.width <= 0 || horizontal <= Math.abs(input.deltaY)) return 0;
  const distanceCommit = horizontal >= input.width * distanceThreshold;
  const velocity = horizontal / Math.max(input.elapsedMs, 1);
  if (!distanceCommit && velocity < velocityThreshold) return 0;
  return input.deltaX < 0 ? 1 : -1;
}
