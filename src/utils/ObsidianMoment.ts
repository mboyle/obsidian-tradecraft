import { moment as obsidianMomentExport } from "obsidian";
import type moment from "moment";

/**
 * Obsidian supplies Moment at runtime. Its public re-export is intentionally
 * converted through `unknown` once so the rest of Tradecraft retains Moment's
 * complete static and instance types without propagating an `any` boundary.
 */
const rawObsidianMoment: unknown = obsidianMomentExport;
if (typeof rawObsidianMoment !== "function") {
  throw new TypeError("Obsidian did not provide its Moment factory.");
}

export const obsidianMoment = rawObsidianMoment as typeof moment;
export type ObsidianMoment = moment.Moment;
