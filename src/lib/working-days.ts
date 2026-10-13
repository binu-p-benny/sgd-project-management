/**
 * Sunday is the one non-working day, and every *automatically computed* planned/due date in the
 * app is counted in working days around it — a span never counts a Sunday, and a computed date
 * never lands on one. Hand-entered dates (an admin's override, a planned date typed into a
 * tracker) are left exactly as entered; this is only about what the system works out by itself.
 *
 * Kept free of any Prisma/server import so "use client" components can share it too.
 */

// The business runs on IST — a fixed +05:30 with no daylight saving — so "is this a Sunday" is
// asked in IST explicitly rather than in whatever timezone the server happens to run in (UTC on
// Vercel). Date-only values are stored at UTC midnight, which is the same calendar day in IST
// either way; the explicit offset is what keeps a real timestamp (a project created at 01:00 IST
// on a Monday is still Sunday evening in UTC) on the right day.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function isSunday(date: Date): boolean {
  return new Date(date.getTime() + IST_OFFSET_MS).getUTCDay() === 0;
}

function shiftDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Advances `date` by `days` working days. Walks forward a calendar day at a time and only counts
 *  a day toward `days` when it isn't a Sunday — so a Sunday inside the span costs an extra
 *  calendar day rather than shortening the count, and the result (for days > 0) is never a
 *  Sunday. `days` of 0 returns `date` itself unchanged. */
export function addWorkingDays(date: Date, days: number): Date {
  let result = date;
  let remaining = days;
  while (remaining > 0) {
    result = shiftDays(result, 1);
    if (!isSunday(result)) {
      remaining -= 1;
    }
  }
  return result;
}

/** The mirror of addWorkingDays for counting backward from a later anchor — walks one calendar
 *  day at a time toward the past, skipping Sunday the same way, so neither end of a window
 *  computed this way can ever land on one. */
export function subtractWorkingDays(date: Date, days: number): Date {
  let result = date;
  let remaining = days;
  while (remaining > 0) {
    result = shiftDays(result, -1);
    if (!isSunday(result)) {
      remaining -= 1;
    }
  }
  return result;
}

/** `date` itself if it's a working day, else the Monday after — for a computed date that isn't a
 *  span (a planned *start* that's simply "whenever the previous step ended", a weekly/monthly
 *  recurrence) but still mustn't be shown as falling on a Sunday. */
export function rollToWorkingDay(date: Date): Date {
  return isSunday(date) ? shiftDays(date, 1) : date;
}
