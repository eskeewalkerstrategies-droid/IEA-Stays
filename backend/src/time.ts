/** Date helpers in India time. Everything the business sees is Asia/Kolkata. */
const TZ = "Asia/Kolkata";

export function nowIndia(): Date {
  return new Date();
}

/** YYYY-MM-DD for a date as seen in India. */
export function indiaDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function indiaHour(d: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d));
}

export function indiaWeekday(d: Date = new Date()): number {
  // 0 = Sunday ... 6 = Saturday
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** Working hours for sends: Monday to Saturday, 09:30 to 18:30 India time. */
export function withinSendWindow(d: Date = new Date()): boolean {
  const wd = indiaWeekday(d);
  if (wd === 0) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 30 && mins <= 18 * 60 + 30;
}

/** Next moment inside the send window, at or after d. */
export function nextSendSlot(d: Date = new Date()): Date {
  const t = new Date(d);
  for (let i = 0; i < 24 * 8; i++) {
    if (withinSendWindow(t)) return t;
    t.setMinutes(t.getMinutes() + 30);
  }
  return t;
}

/** Adds n working days (Mon to Sat) to a YYYY-MM-DD date. */
export function addWorkingDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00+05:30`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (indiaWeekday(d) !== 0) left--;
  }
  return indiaDate(d);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + n);
  return indiaDate(d);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Indian financial year label for a date, e.g. 26-27 for any day from April 2026 to March 2027. */
export function financialYear(ymd: string = indiaDate()): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}
