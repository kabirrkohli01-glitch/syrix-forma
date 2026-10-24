import { describe, expect, it } from 'vitest';
import {
  calculateMileagePence,
  formatMinuteOfDay,
  formatMinutes,
  formatPence,
  poundsToPence,
  rateInForceOn,
  shiftPaidMinutes
} from '@/lib/hr/money';

describe('poundsToPence', () => {
  it('parses whole and decimal amounts', () => {
    expect(poundsToPence('12')).toBe(1200);
    expect(poundsToPence('12.50')).toBe(1250);
    expect(poundsToPence('0.05')).toBe(5);
    expect(poundsToPence('12.5')).toBe(1250);
  });

  it('strips currency symbols, commas and spaces', () => {
    expect(poundsToPence('£1,250.99')).toBe(125_099);
    expect(poundsToPence(' 12.34 ')).toBe(1234);
  });

  it('handles negatives', () => {
    expect(poundsToPence('-5.25')).toBe(-525);
  });

  it('does not lose a penny to floating point', () => {
    // Math.round(8.075 * 100) is 807, because the float is a hair below 807.5. Parsing the
    // digits avoids the question entirely.
    expect(poundsToPence('8.07')).toBe(807);
    expect(poundsToPence('1.10')).toBe(110);
    expect(poundsToPence('1.15')).toBe(115);
    expect(poundsToPence('29.97')).toBe(2997);
  });

  it('rejects anything that is not an amount', () => {
    expect(() => poundsToPence('abc')).toThrow();
    expect(() => poundsToPence('1.234')).toThrow();
    expect(() => poundsToPence('')).toThrow();
  });
});

describe('formatPence', () => {
  it('formats with two decimal places and thousands separators', () => {
    expect(formatPence(1250)).toBe('£12.50');
    expect(formatPence(5)).toBe('£0.05');
    expect(formatPence(0)).toBe('£0.00');
    expect(formatPence(125_099)).toBe('£1,250.99');
  });

  it('formats negatives with the sign before the symbol', () => {
    expect(formatPence(-525)).toBe('-£5.25');
  });

  it('round-trips with poundsToPence', () => {
    for (const value of ['0.01', '9.99', '1234.56']) {
      expect(formatPence(poundsToPence(value))).toBe(
        `£${Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`
      );
    }
  });
});

describe('formatMinutes', () => {
  it('formats hours and minutes', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(480)).toBe('8h');
  });

  it('formats a negative balance rather than hiding it', () => {
    expect(formatMinutes(-30)).toBe('-30m');
    expect(formatMinutes(-90)).toBe('-1h 30m');
  });
});

describe('formatMinuteOfDay', () => {
  it('renders 24-hour time', () => {
    expect(formatMinuteOfDay(0)).toBe('00:00');
    expect(formatMinuteOfDay(540)).toBe('09:00');
    expect(formatMinuteOfDay(1_020)).toBe('17:00');
    expect(formatMinuteOfDay(1_439)).toBe('23:59');
  });

  it('wraps a shift that crosses midnight instead of showing 26:00', () => {
    expect(formatMinuteOfDay(1_560)).toBe('02:00');
  });
});

describe('shiftPaidMinutes', () => {
  it('subtracts the unpaid break', () => {
    expect(shiftPaidMinutes({ startMinute: 540, endMinute: 1020, unpaidBreakMinutes: 60 })).toBe(
      420
    );
  });

  it('handles a shift crossing midnight', () => {
    // 22:00 to 06:00 the next day is 1320 to 1800 in minutes-from-midnight.
    expect(shiftPaidMinutes({ startMinute: 1320, endMinute: 1800, unpaidBreakMinutes: 30 })).toBe(
      450
    );
  });

  it('never returns negative paid time when the break exceeds the shift', () => {
    expect(shiftPaidMinutes({ startMinute: 540, endMinute: 570, unpaidBreakMinutes: 60 })).toBe(0);
  });
});

describe('calculateMileagePence', () => {
  // HMRC car rates: 45p for the first 10,000 miles in the tax year, 25p after that.
  const bands = [
    { fromMiles: 0, pencePerMile: 45 },
    { fromMiles: 10_000, pencePerMile: 25 }
  ];

  it('charges the first band when well below the threshold', () => {
    expect(calculateMileagePence({ miles: 100, milesAlreadyClaimed: 0, bands })).toBe(4_500);
  });

  it('charges the second band when already past the threshold', () => {
    expect(calculateMileagePence({ miles: 100, milesAlreadyClaimed: 12_000, bands })).toBe(2_500);
  });

  it('splits a journey that crosses the threshold across both rates', () => {
    // 9,950 already claimed; a 100-mile trip takes 50 miles at 45p and 50 at 25p.
    const pence = calculateMileagePence({ miles: 100, milesAlreadyClaimed: 9_950, bands });
    expect(pence).toBe(50 * 45 + 50 * 25);
    // Charging the whole trip at one rate would be 4,500 or 2,500 — both wrong.
    expect(pence).not.toBe(4_500);
    expect(pence).not.toBe(2_500);
  });

  it('lands exactly on the threshold without double-counting', () => {
    expect(calculateMileagePence({ miles: 10_000, milesAlreadyClaimed: 0, bands })).toBe(
      10_000 * 45
    );
  });

  it('returns nothing for a zero or negative distance', () => {
    expect(calculateMileagePence({ miles: 0, milesAlreadyClaimed: 0, bands })).toBe(0);
    expect(calculateMileagePence({ miles: -5, milesAlreadyClaimed: 0, bands })).toBe(0);
  });

  it('refuses to guess when no rates are configured', () => {
    expect(() => calculateMileagePence({ miles: 10, milesAlreadyClaimed: 0, bands: [] })).toThrow(
      /no mileage rates/i
    );
  });
});

describe('rateInForceOn', () => {
  const rates = [
    { effectiveFrom: '2024-04-06', pencePerMile: 45 },
    { effectiveFrom: '2026-04-06', pencePerMile: 50 }
  ];

  it('picks the latest rate effective on or before the date', () => {
    expect(rateInForceOn(rates, '2026-01-01')!.pencePerMile).toBe(45);
    expect(rateInForceOn(rates, '2026-04-06')!.pencePerMile).toBe(50);
    expect(rateInForceOn(rates, '2027-01-01')!.pencePerMile).toBe(50);
  });

  it('returns nothing when no rate had come into force yet', () => {
    expect(rateInForceOn(rates, '2020-01-01')).toBeNull();
  });
});
