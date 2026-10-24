/* The team a record gets when the person creating it has none.
 *
 * WHY THIS EXISTS. `team` is `notNull` on clients, projects, tasks, enquiries
 * and calendar events, because team is how business data is scoped — see the
 * comment on `tasks.team` in the schema. Every create action therefore read the
 * caller's team, and every one of them THREW when it was null: "A team is
 * required to create a task", and the same for the other four.
 *
 * That turned an optional organisational feature into a hard prerequisite for
 * using the application at all. An admin setting up the Hub, or anyone whose
 * team had not been assigned yet, could not create a single record — and the
 * error told them to fix something they had no reason to think they needed.
 * Nothing about a one-person or not-yet-organised firm should be blocked on
 * having drawn up a team structure first.
 *
 * WHAT THIS IS NOT. It is not a permission change. The team a record lands in
 * still governs who can see it, and `scopeForBusinessData` is untouched — a
 * record created here is exactly as visible as one created by somebody whose
 * team was set to the same value by hand. All that changes is that the absence
 * of a team stops being a refusal and becomes a default.
 *
 * The value is a real team name rather than a sentinel like `__none__`, because
 * it appears in the interface wherever a team is shown, and a record labelled
 * with a placeholder reads as a bug to the person looking at it.
 */

export const DEFAULT_TEAM = 'general';

/**
 * The team to file a new record under.
 *
 * Takes the caller's team when they have one, so nothing changes for an
 * organisation that does use teams.
 */
export function teamForNewRecord(callerTeam: string | null | undefined): string {
  const team = callerTeam?.trim();
  return team && team.length > 0 ? team : DEFAULT_TEAM;
}
