/**
 * Reading a message's route trail out loud.
 *
 * Client-safe: no logging, no server imports. The Salon's avatar column and its
 * tests both import from here, so the wording of "who was asked, and what came
 * of it" lives in exactly one place.
 *
 * Storage is the faithful audit — every attempt, in order, including the
 * same-profile retry that is really one profile asked twice. The *collapse*
 * below is presentation only: adjacent entries for one profile become one row.
 *
 * @module chat/route-trail-display
 */

import type { RouteAttempt, RouteAttemptOutcome, RouteAttemptVia } from '@/lib/schemas/chat.types';

/**
 * The marks a row wears when it did not answer.
 *
 * Plain emoji by request, defined once so a later move to the themeable
 * `<Icon>` registry (`ban`, `close`, `alert-triangle` all exist) is a one-line
 * change. The row that answered wears no mark at all.
 */
export const ROUTE_OUTCOME_GLYPH = { failed: '❌', refused: '🚫' } as const;

/** One rendered line of the call sheet: a profile, and how it fared. */
export interface RouteTrailRow {
  profileId: string;
  profileName: string;
  provider: string;
  modelName: string;
  /** How the profile came to be asked — taken from the FIRST attempt in the run. */
  via: RouteAttemptVia;
  /** What became of it — taken from the LAST attempt in the run. */
  outcome: RouteAttemptOutcome;
  /** The last attempt's failure class, when it had one. */
  trigger?: RouteAttempt['trigger'];
  /** The last attempt's refusal evidence, when it had one. */
  evidence?: RouteAttempt['evidence'];
  /** The last attempt's short reason, when it had one. */
  detail?: string;
  /** How many adjacent attempts against this profile collapsed into this row (≥ 1). */
  attempts: number;
}

/**
 * Collapse adjacent entries for the same profile into one row.
 *
 * The same-profile retry after an empty body is the common case: storage
 * records two attempts, the reader wants one line. Non-adjacent repeats do NOT
 * collapse — a profile asked, passed over, and asked again later is genuinely
 * two turns of the call sheet and reads as such.
 */
export function collapseRouteTrail(trail: RouteAttempt[]): RouteTrailRow[] {
  const rows: RouteTrailRow[] = [];

  for (const attempt of trail) {
    const previous = rows[rows.length - 1];
    if (previous && previous.profileId === attempt.profileId) {
      // Keep the run's opening `via` (how the profile came to be asked at all)
      // and take everything else from the latest word on it.
      previous.outcome = attempt.outcome;
      previous.trigger = attempt.trigger;
      previous.evidence = attempt.evidence;
      previous.detail = attempt.detail;
      previous.attempts += 1;
      continue;
    }
    rows.push({
      profileId: attempt.profileId,
      profileName: attempt.profileName,
      provider: attempt.provider,
      modelName: attempt.modelName,
      via: attempt.via,
      outcome: attempt.outcome,
      trigger: attempt.trigger,
      evidence: attempt.evidence,
      detail: attempt.detail,
      attempts: 1,
    });
  }

  return rows;
}

/** How the profile came to be standing there at all. */
function describeVia(via: RouteAttemptVia): string {
  switch (via) {
    case 'primary':
      return 'first on the call sheet';
    case 'retry':
      return 'asked again on the same profile';
    case 'concierge':
      return 'sent by the Concierge';
    case 'understudy':
      return 'stood in as the understudy';
    case 'tier-pick':
      return 'drafted from the company by tier';
    default:
      return 'asked';
  }
}

const ORDINALS = ['', '', 'second', 'third', 'fourth', 'fifth'];

/** What came of it. */
function describeOutcome(row: RouteTrailRow): string {
  if (row.outcome === 'answered') {
    if (row.attempts > 1) {
      const ordinal = ORDINALS[row.attempts];
      return ordinal ? `answered on the ${ordinal} try` : `answered on try ${row.attempts}`;
    }
    return 'answered';
  }

  if (row.outcome === 'refused') {
    const evidence = row.evidence === 'inferred' ? ' — inferred' : '';
    return `refused on content grounds${evidence}${row.detail ? ` (${row.detail})` : ''}`;
  }

  const trigger = row.trigger ? `: ${row.trigger}` : '';
  return `fell over${trigger}${row.detail ? ` (${row.detail})` : ''}`;
}

/**
 * The hover text for one row: the profile's own name (users name their
 * profiles, and three OpenAI profiles need telling apart), what it is, how it
 * came to be asked, and what happened.
 */
export function describeRouteAttempt(row: RouteTrailRow): string {
  return `${row.profileName} · ${row.provider}: ${row.modelName} — ${describeVia(row.via)}; ${describeOutcome(row)}`;
}

/** Accessible label for a row's glyph. */
export function routeOutcomeLabel(outcome: RouteAttemptOutcome): string {
  switch (outcome) {
    case 'failed':
      return 'failed';
    case 'refused':
      return 'refused on content grounds';
    default:
      return 'answered';
  }
}
