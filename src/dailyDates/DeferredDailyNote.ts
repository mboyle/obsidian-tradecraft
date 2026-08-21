export const DEFERRED_DAILY_NOTE_STARTER = "- ";

/** Empty content and a lone Markdown list marker are only visual placeholders. */
export function hasMeaningfulDeferredDailyContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return !/^(?:[-+*]|\d+[.)])(?:\s+\[[ xX]\])?\s*$/.test(trimmed);
}

/** Project an empty persisted note as the same in-memory starter used for a missing note. */
export function dailyContentForEditing(content: string): string {
  return hasMeaningfulDeferredDailyContent(content)
    ? content
    : DEFERRED_DAILY_NOTE_STARTER;
}

/** Never persist a visual-only starter marker as note content. */
export function dailyContentForPersistence(content: string): string {
  return hasMeaningfulDeferredDailyContent(content) ? content : "";
}
