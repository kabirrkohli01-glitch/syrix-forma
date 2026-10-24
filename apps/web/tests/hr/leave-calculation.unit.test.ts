import { describe, expect, it } from 'vitest';
import {
  bradfordFactor,
  calculateBalance,
  calculateLeaveHalfDays,
  countWorkingDays,
  datesInRange,
  formatHalfDays,
  isWeekend,
  leaveYearEndFor,
  leaveYearStartFor,
  proRataEntitlement,
  rangesOverlap
} from '@/lib/hr/leave-calculation';

// 2026 England and Wales bank holidays falling in the ranges these tests use.
const GOOD_FRIDAY_2026 = '2026-04-03';
const EASTER_MONDAY_2026 = '2026-04-06';
const MAY_DAY_2026 = '2026-05-04';

describe('datesInRange', () => {
  it('includes both ends', () => {
    expect(datesInRange('2026-04-01', '2026-04-03')).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03'
    ]);
  });

  it('returns a single date when start and end are the same day', () => {
    expect(datesInRange('2026-04-01', '2026-04-01')).toEqual(['2026-04-01']);
  });

  it('returns nothing when the range is backwards', () => {
    expect(datesInRange('2026-04-05', '2026-04-01')).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(datesInRange('2026-03-30', '2026-04-02')).toEqual([
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02'
    ]);
  });

  it('handles a leap day', () => {
    expect(datesInRange('2028-02-28', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01'
    ]);
  });
});

describe('isWeekend', () => {
  it('identifies Saturday and Sunday', () => {
    // 2026-04-04 is a Saturday, 2026-04-05 a Sunday.
    expect(isWeekend('2026-04-04')).toBe(true);
    expect(isWeekend('2026-04-05')).toBe(true);
  });

  it('does not treat a weekday as a weekend', () => {
    expect(isWeekend('2026-04-02')).toBe(false);
  });

  it('does not shift the day for a date parsed near midnight UTC', () => {
    // Local-time parsing of '2026-04-05' west of UTC would land on the 4th and still report a
    // weekend, hiding the bug. The 6th is a Monday and would become a Sunday — this is the
    // case that catches it.
    expect(isWeekend('2026-04-06')).toBe(false);
  });
});

describe('countWorkingDays', () => {
  it('excludes weekends', () => {
    // Mon 2026-04-13 to Fri 2026-04-17 is five working days.
    expect(countWorkingDays('2026-04-13', '2026-04-17', [])).toBe(5);
    // Extending across the weekend to the following Friday adds five more, not seven.
    expect(countWorkingDays('2026-04-13', '2026-04-24', [])).toBe(10);
  });

  it('excludes public holidays', () => {
    // Good Friday and Easter Monday bracket the weekend of 4-5 April 2026.
    expect(countWorkingDays('2026-04-02', '2026-04-07', [])).toBe(4);
    expect(
      countWorkingDays('2026-04-02', '2026-04-07', [GOOD_FRIDAY_2026, EASTER_MONDAY_2026])
    ).toBe(2);
  });

  it('ignores a public holiday that falls on a weekend', () => {
    expect(countWorkingDays('2026-04-13', '2026-04-17', ['2026-04-18'])).toBe(5);
  });

  it('returns zero for a range entirely inside a weekend', () => {
    expect(countWorkingDays('2026-04-04', '2026-04-05', [])).toBe(0);
  });
});

describe('calculateLeaveHalfDays', () => {
  const base = { startUnit: 'full', endUnit: 'full', publicHolidays: [] } as const;

  it('charges two half days for one whole working day', () => {
    expect(
      calculateLeaveHalfDays({ ...base, startDate: '2026-04-13', endDate: '2026-04-13' })
    ).toBe(2);
  });

  it('charges one half day for a single morning', () => {
    expect(
      calculateLeaveHalfDays({
        ...base,
        startDate: '2026-04-13',
        endDate: '2026-04-13',
        startUnit: 'am',
        endUnit: 'am'
      })
    ).toBe(1);
  });

  it('does not double-deduct on a single-day half-day request', () => {
    // Both units describe the same day here; applying each in turn would deduct the whole day.
    expect(
      calculateLeaveHalfDays({
        ...base,
        startDate: '2026-04-13',
        endDate: '2026-04-13',
        startUnit: 'pm',
        endUnit: 'am'
      })
    ).toBe(1);
  });

  it('charges a full working week as ten half days', () => {
    expect(
      calculateLeaveHalfDays({ ...base, startDate: '2026-04-13', endDate: '2026-04-17' })
    ).toBe(10);
  });

  it('deducts a half day at each end of a multi-day request', () => {
    expect(
      calculateLeaveHalfDays({
        ...base,
        startDate: '2026-04-13',
        endDate: '2026-04-17',
        startUnit: 'pm',
        endUnit: 'am'
      })
    ).toBe(8);
  });

  it('charges nothing for a range made entirely of non-working days', () => {
    expect(
      calculateLeaveHalfDays({ ...base, startDate: '2026-04-04', endDate: '2026-04-05' })
    ).toBe(0);
  });

  it('does not go negative when a half-day unit lands on a public holiday', () => {
    // Starting on Good Friday with a half-day unit: the day is not a working day, so the half
    // day must not be subtracted from a total that never included it.
    const result = calculateLeaveHalfDays({
      startDate: GOOD_FRIDAY_2026,
      endDate: '2026-04-07',
      startUnit: 'pm',
      endUnit: 'full',
      publicHolidays: [GOOD_FRIDAY_2026, EASTER_MONDAY_2026]
    });
    expect(result).toBe(2);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('never returns a fractional number of half days', () => {
    const result = calculateLeaveHalfDays({
      ...base,
      startDate: '2026-05-01',
      endDate: '2026-05-08',
      startUnit: 'pm',
      endUnit: 'am',
      publicHolidays: [MAY_DAY_2026]
    });
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe('formatHalfDays', () => {
  it('formats whole and half days', () => {
    expect(formatHalfDays(2)).toBe('1 day');
    expect(formatHalfDays(1)).toBe('0.5 days');
    expect(formatHalfDays(10)).toBe('5 days');
    expect(formatHalfDays(11)).toBe('5.5 days');
    expect(formatHalfDays(0)).toBe('0 days');
  });

  it('formats a negative balance rather than hiding it', () => {
    expect(formatHalfDays(-2)).toBe('-1 day');
  });
});

describe('calculateBalance', () => {
  it('adds carry-over and adjustment into the total', () => {
    const balance = calculateBalance({
      entitlementHalfDays: 50,
      carriedOverHalfDays: 6,
      adjustmentHalfDays: 2,
      takenHalfDays: 10,
      pendingHalfDays: 4
    });
    expect(balance.totalHalfDays).toBe(58);
    expect(balance.remainingHalfDays).toBe(48);
  });

  it('deducts pending requests from what is available to book against', () => {
    const balance = calculateBalance({
      entitlementHalfDays: 50,
      carriedOverHalfDays: 0,
      adjustmentHalfDays: 0,
      takenHalfDays: 40,
      pendingHalfDays: 8
    });
    // Ten half days remain on paper, but eight are already spoken for.
    expect(balance.remainingHalfDays).toBe(10);
    expect(balance.availableHalfDays).toBe(2);
  });

  it('handles a negative adjustment', () => {
    const balance = calculateBalance({
      entitlementHalfDays: 50,
      carriedOverHalfDays: 0,
      adjustmentHalfDays: -4,
      takenHalfDays: 0,
      pendingHalfDays: 0
    });
    expect(balance.totalHalfDays).toBe(46);
  });
});

describe('leaveYearStartFor', () => {
  it('puts a date after the start day in the year that just began', () => {
    expect(leaveYearStartFor('2026-06-15', 4, 1)).toBe('2026-04-01');
  });

  it('puts a date before the start day in the previous leave year', () => {
    expect(leaveYearStartFor('2026-03-31', 4, 1)).toBe('2025-04-01');
  });

  it('treats the start day itself as the first day of the new year', () => {
    expect(leaveYearStartFor('2026-04-01', 4, 1)).toBe('2026-04-01');
  });

  it('handles a January leave year', () => {
    expect(leaveYearStartFor('2026-12-31', 1, 1)).toBe('2026-01-01');
    expect(leaveYearStartFor('2026-01-01', 1, 1)).toBe('2026-01-01');
  });
});

describe('leaveYearEndFor', () => {
  it('ends the day before the next year begins', () => {
    expect(leaveYearEndFor('2026-04-01')).toBe('2027-03-31');
    expect(leaveYearEndFor('2026-01-01')).toBe('2026-12-31');
  });
});

describe('proRataEntitlement', () => {
  it('leaves a full-time entitlement alone', () => {
    expect(proRataEntitlement({ fullTimeEntitlementHalfDays: 50 })).toBe(50);
  });

  it('halves entitlement for someone working two and a half days', () => {
    expect(proRataEntitlement({ fullTimeEntitlementHalfDays: 50, workingDaysPerWeek: 2.5 })).toBe(
      25
    );
  });

  it('rounds up rather than shortchanging the employee', () => {
    // 50 × 3/5 × 0.5 = 15 exactly; 50 × 3/5 × 0.55 = 16.5 must become 17, not 16.
    expect(
      proRataEntitlement({
        fullTimeEntitlementHalfDays: 50,
        workingDaysPerWeek: 3,
        proportionOfYear: 0.55
      })
    ).toBe(17);
  });

  it('does not inflate entitlement for someone recorded as working six days', () => {
    expect(proRataEntitlement({ fullTimeEntitlementHalfDays: 50, workingDaysPerWeek: 6 })).toBe(50);
  });

  it('ignores a zero or null working pattern rather than zeroing entitlement', () => {
    expect(proRataEntitlement({ fullTimeEntitlementHalfDays: 50, workingDaysPerWeek: 0 })).toBe(50);
    expect(proRataEntitlement({ fullTimeEntitlementHalfDays: 50, workingDaysPerWeek: null })).toBe(
      50
    );
  });
});

describe('bradfordFactor', () => {
  it('weights frequent short absences far above one long one', () => {
    expect(bradfordFactor(8, 8)).toBe(512);
    expect(bradfordFactor(1, 8)).toBe(8);
  });

  it('is zero when there has been no absence', () => {
    expect(bradfordFactor(0, 0)).toBe(0);
  });
});

describe('rangesOverlap', () => {
  it('detects an overlap in either direction', () => {
    expect(rangesOverlap('2026-04-01', '2026-04-10', '2026-04-05', '2026-04-15')).toBe(true);
    expect(rangesOverlap('2026-04-05', '2026-04-15', '2026-04-01', '2026-04-10')).toBe(true);
  });

  it('counts a single shared day as an overlap', () => {
    expect(rangesOverlap('2026-04-01', '2026-04-10', '2026-04-10', '2026-04-20')).toBe(true);
  });

  it('does not report adjacent ranges as overlapping', () => {
    expect(rangesOverlap('2026-04-01', '2026-04-09', '2026-04-10', '2026-04-20')).toBe(false);
  });
});
