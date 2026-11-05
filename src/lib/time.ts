// Org-local calendar math for analytics and quotas. One org time zone until it becomes an org
// setting (with Clerk); the Gulf default matches next-intl's timeZone in src/i18n/request.ts.

export const ORG_TIME_ZONE = "Asia/Dubai";

const dayFormat = new Map<string, Intl.DateTimeFormat>();

/** "2026-11-02" for the calendar day `date` falls on in `timeZone`. */
export function dayKey(date: Date, timeZone = ORG_TIME_ZONE) {
  let format = dayFormat.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormat.set(timeZone, format);
  }
  return format.format(date);
}

/** The instant local midnight starts on `key` ("YYYY-MM-DD") in `timeZone`. */
export function startOfDay(key: string, timeZone = ORG_TIME_ZONE) {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, Number(p.value)]),
  );
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(guess - (wall - guess));
}

/** `count` consecutive day keys ending today (oldest first). */
export function lastDays(count: number, now = new Date(), timeZone = ORG_TIME_ZONE) {
  const today = startOfDay(dayKey(now, timeZone), timeZone);
  return Array.from({ length: count }, (_, i) => dayKey(new Date(today.getTime() - (count - 1 - i) * 86_400_000 + 12 * 3_600_000), timeZone));
}

export function startOfMonth(now = new Date(), timeZone = ORG_TIME_ZONE) {
  return startOfDay(`${dayKey(now, timeZone).slice(0, 8)}01`, timeZone);
}
