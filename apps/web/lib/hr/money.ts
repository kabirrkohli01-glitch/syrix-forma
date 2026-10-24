/**
 * Money and duration helpers for the time-and-attendance and expenses modules.
 *
 * Money is integer pence and durations are integer minutes everywhere — see the comment on
 * `pay_rates` in lib/db/schema.ts. Nothing outside this module converts between pence and
 * pounds, so there is exactly one place for a rounding decision to live.
 */

/** Parses user input in pounds ("12.50", "£12.50", "1,250") into exact pence. */
export function poundsToPence(input: string | number): number {
  const raw = typeof input === 'number' ? input.toFixed(2) : input.trim().replace(/[£,\s]/gu, '');
  if (!/^-?\d+(\.\d{1,2})?$/u.test(raw)) {
    throw new Error(`Not an amount: ${input}`);
  }

  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace('-', '').split('.');
  // Parsed digit by digit rather than via `Math.round(Number(raw) * 100)`, which turns 8.075
  // into 807 on some inputs because the float is slightly below the true value.
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -pence : pence;
}

export function formatPence(pence: number, currency = 'GBP'): string {
  const symbol = currency === 'GBP' ? '£' : `${currency} `;
  const negative = pence < 0;
  const absolute = Math.abs(pence);
  const formatted = `${Math.floor(absolute / 100).toLocaleString('en-GB')}.${String(
    absolute % 100
  ).padStart(2, '0')}`;
  return `${negative ? '-' : ''}${symbol}${formatted}`;
}

export function formatMinutes(minutes: number): string {
  const negative = minutes < 0;
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  if (hours === 0) return `${negative ? '-' : ''}${remainder}m`;
  if (remainder === 0) return `${negative ? '-' : ''}${hours}h`;
  return `${negative ? '-' : ''}${hours}h ${remainder}m`;
}

/** Minutes from midnight rendered as 24-hour clock time. */
export function formatMinuteOfDay(minute: number): string {
  // A shift crossing midnight has an end beyond 1440; wrap so it reads as the next morning
  // rather than as "26:00".
  const wrapped = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** Paid minutes in a shift, after the unpaid break. Never negative. */
export function shiftPaidMinutes(shift: {
  startMinute: number;
  endMinute: number;
  unpaidBreakMinutes: number;
}): number {
  const span = shift.endMinute - shift.startMinute;
  return Math.max(span - shift.unpaidBreakMinutes, 0);
}

export type MileageBand = { fromMiles: number; pencePerMile: number };

/**
 * Mileage for a journey, given the bands in force and how many miles the employee has already
 * claimed this tax year.
 *
 * HMRC's approved rates are tiered by cumulative annual mileage (45p for the first 10,000
 * miles, 25p thereafter, for a car). A journey that crosses the threshold is split across both
 * rates rather than charged entirely at one — charging the whole trip at the lower rate
 * underpays the employee, and at the higher rate creates a taxable benefit.
 */
export function calculateMileagePence(input: {
  miles: number;
  milesAlreadyClaimed: number;
  bands: MileageBand[];
}): number {
  if (input.miles <= 0) return 0;
  const bands = [...input.bands].toSorted((a, b) => a.fromMiles - b.fromMiles);
  if (bands.length === 0) throw new Error('No mileage rates configured');

  let remaining = input.miles;
  let position = input.milesAlreadyClaimed;
  let pence = 0;

  while (remaining > 0) {
    // The band `position` currently falls in: the last one whose lower bound it has reached.
    const bandIndex = bands.findLastIndex((band) => position >= band.fromMiles);
    const band = bands[bandIndex] ?? bands[0];
    const nextBand = bands[bandIndex + 1];

    // How far until the next band starts; unbounded if this is the last band.
    const milesInThisBand = nextBand
      ? Math.min(remaining, nextBand.fromMiles - position)
      : remaining;
    // Guard against a malformed band list (two bands with the same lower bound) looping.
    const step = milesInThisBand > 0 ? milesInThisBand : remaining;

    pence += step * band.pencePerMile;
    position += step;
    remaining -= step;
  }

  return pence;
}

/** The rate that applied on a given date — the latest one effective on or before it. */
export function rateInForceOn<T extends { effectiveFrom: string }>(
  rates: T[],
  onDate: string
): T | null {
  const applicable = rates
    .filter((rate) => rate.effectiveFrom <= onDate)
    .toSorted((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return applicable.at(-1) ?? null;
}
