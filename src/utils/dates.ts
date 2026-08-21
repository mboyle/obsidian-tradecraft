export interface ParsedSourceDate {
  timestamp: number;
  date: Date;
}

export function parseFilenameDate(basename: string, formats: string[]): ParsedSourceDate | undefined {
  for (const format of formats) {
    const match = compileDateFormat(format).exec(basename);
    if (!match?.groups) continue;
    const year = Number(match.groups.year);
    const month = Number(match.groups.month);
    const day = Number(match.groups.day);
    const parsed = validatedDate(year, month, day);
    if (parsed) return { date: parsed, timestamp: parsed.getTime() };
  }
  return undefined;
}

export function parseDateValue(value: unknown): ParsedSourceDate | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { date: value, timestamp: value.getTime() };
  }
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : { date, timestamp: date.getTime() };
}

export function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function validatedDate(year: number, month: number, day: number): Date | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  date.setHours(0, 0, 0, 0);
  return date;
}

function compileDateFormat(format: string): RegExp {
  const tokens = /(YYYY|MM|DD|dddd)/g;
  let cursor = 0;
  let expression = "^";
  for (const match of format.matchAll(tokens)) {
    const index = match.index ?? 0;
    expression += escapeRegExp(format.slice(cursor, index));
    switch (match[0]) {
      case "YYYY":
        expression += "(?<year>\\d{4})";
        break;
      case "MM":
        expression += "(?<month>\\d{2})";
        break;
      case "DD":
        expression += "(?<day>\\d{2})";
        break;
      case "dddd":
        expression += "(?:[\\p{L}.]+)";
        break;
    }
    cursor = index + match[0].length;
  }
  expression += `${escapeRegExp(format.slice(cursor))}$`;
  return new RegExp(expression, "u");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
