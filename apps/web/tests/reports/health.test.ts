import { describe, expect, it } from 'vitest';
import { computeProjectHealth } from '@/features/reports/utils/health';

describe('computeProjectHealth', () => {
  it('is green with no overdue tasks or milestones', () => {
    expect(computeProjectHealth(0, 0)).toBe('green');
  });

  it('is amber with 1-2 overdue tasks and no overdue milestones', () => {
    expect(computeProjectHealth(0, 1)).toBe('amber');
    expect(computeProjectHealth(0, 2)).toBe('amber');
  });

  it('is red with 3+ overdue tasks even if no milestone is overdue', () => {
    expect(computeProjectHealth(0, 3)).toBe('red');
    expect(computeProjectHealth(0, 5)).toBe('red');
  });

  it('is red if any milestone is overdue, regardless of task count', () => {
    expect(computeProjectHealth(1, 0)).toBe('red');
    expect(computeProjectHealth(1, 1)).toBe('red');
  });
});
