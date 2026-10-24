export type ProjectHealth = 'green' | 'amber' | 'red';

// Deterministic thresholds, not a subjective score, so the label on the Reports page is always
// reproducible from the same two counts a reviewer can independently query: RED if any milestone
// is overdue or 3+ tasks are overdue; AMBER if 1-2 tasks are overdue with no overdue milestones;
// GREEN otherwise. Kept as its own pure function so the rule is one testable statement rather
// than logic spread across a query file.
export function computeProjectHealth(
  overdueMilestoneCount: number,
  overdueTaskCount: number
): ProjectHealth {
  if (overdueMilestoneCount > 0 || overdueTaskCount >= 3) return 'red';
  if (overdueTaskCount >= 1) return 'amber';
  return 'green';
}
