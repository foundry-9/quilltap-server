/**
 * Operator intervention — what a model is told when the operator vetoes its
 * `run_custom` call (spec I13).
 *
 * A plain character does not know the chat is a game, so it hears only that
 * the tool did not run — as generic as a flaky tool call, with nothing about a
 * table, a game or anyone deciding. Only a `systemTransparency` character, or
 * a user-controlled seat, hears that the table is closed.
 *
 * The one place these strings are spelled: the handler and its tests use them,
 * and nobody hand-writes the plain wording elsewhere.
 */

/** For a character that does not know it is in a game. */
export const VETO_RESULT_PLAIN = 'The tool did not run.';

/** For a character that knows about Pascal and the staff. */
export const VETO_RESULT_TRANSPARENT = 'The table is closed for the moment; this tool did not run. Carry on without it.';

/** The veto's tool-result wording for a caller who does (or does not) know the chat is a game. */
export function vetoResultFor(transparent: boolean): string {
  return transparent ? VETO_RESULT_TRANSPARENT : VETO_RESULT_PLAIN;
}
