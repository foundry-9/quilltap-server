/**
 * Mention typeahead — pure logic.
 *
 * The decisions behind the composer's `@` character typeahead: where an `@name`
 * trigger starts and ends, which characters match a query and in what order,
 * and what becomes of the `@` once a name has been completed at the start of a
 * line.
 *
 * ### The `@` after completion
 *
 * A completed mention inserts the character's plain name — no chip, no node, no
 * markup — so the `@` is normally dropped (`see @aris` → `see Aristarchus`).
 * The exception is the start of a line, where `@Name: question` and
 * `@Name? question` are Carina queries (`lib/chat/carina-parser.ts`). There the
 * `@` is kept provisionally and judged by what the writer types next:
 * {@link classifyLineStartMention}.
 *
 * Framework-free: the trigger rule comes from `lib/char-insert/trigger.ts` and
 * nothing here touches React or Lexical.
 *
 * @module lib/mentions/mention-typeahead
 */

import { isCarinaInvocableName } from '@/lib/chat/carina-parser';
import { findTrigger } from '@/lib/char-insert/trigger';
import type { TriggerConfig, TriggerMatch } from '@/lib/char-insert/types';

/**
 * `@` plus letters, digits, `_` or `-`. A space ends the query — and, with at
 * least one query character typed, commits the highlighted name.
 *
 * `minQueryLength: 0` is deliberate: a bare `@` opens the whole list. The
 * opener-context rule in `findTrigger` is what keeps `name@example.com` from
 * ever opening it.
 */
export const MENTION_TRIGGER: TriggerConfig = {
  opener: '@',
  queryPattern: /[\p{L}\p{M}\p{N}_-]/u,
  minQueryLength: 0,
  maxQueryLength: 48,
  closer: null,
  lowercaseQuery: false,
};

/** Find the active `@query` in the text before the cursor, or null. */
export function findMentionTrigger(textBefore: string): TriggerMatch | null {
  return findTrigger(textBefore, MENTION_TRIGGER);
}

/** The minimum a character needs in order to be offered. */
export interface MentionCandidate {
  id: string;
  name: string;
  title?: string | null;
}

/**
 * Match quality: whole-name prefix beats word prefix (`vi` → `Lady Vivienne`).
 * Mid-word substrings are deliberately not matched — `ar` offering `Barnaby`
 * is noise in a list meant to narrow as you type.
 */
const MatchTier = { NamePrefix: 0, WordPrefix: 1 } as const;
type MatchTier = (typeof MatchTier)[keyof typeof MatchTier];

function matchTier(name: string, query: string): MatchTier | null {
  if (query.length === 0) return MatchTier.NamePrefix;
  const folded = name.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  if (folded.startsWith(needle)) return MatchTier.NamePrefix;
  if (folded.split(/[\s\-_'’.]+/u).some((word) => word.startsWith(needle))) return MatchTier.WordPrefix;
  return null;
}

/**
 * Filter and order candidates for a query.
 *
 * Characters in `priorityIds` (the current chat's cast) come first, then by
 * match tier, then alphabetically. Case-insensitive throughout. Blank names are
 * never offered.
 */
export function rankMentionCandidates<T extends MentionCandidate>(
  candidates: readonly T[],
  query: string,
  priorityIds: ReadonlySet<string>,
  limit: number,
): T[] {
  const scored: Array<{ candidate: T; priority: number; tier: MatchTier }> = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate.name || !candidate.name.trim() || seen.has(candidate.id)) continue;
    const tier = matchTier(candidate.name, query);
    if (tier === null) continue;
    seen.add(candidate.id);
    scored.push({ candidate, priority: priorityIds.has(candidate.id) ? 0 : 1, tier });
  }

  scored.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.tier - b.tier ||
      a.candidate.name.localeCompare(b.candidate.name, undefined, { sensitivity: 'base' }),
  );

  return scored.slice(0, limit).map((entry) => entry.candidate);
}

/**
 * What to do with a line that began as a completed `@Name`.
 *
 * - `pending` — undecided: nothing typed yet, or only the `:` / `?` separator.
 * - `keep`    — `@Name:` or `@Name?` followed by whitespace: a Carina query.
 * - `strip`   — anything else followed the name, or the name is one the
 *               Carina parser cannot address: drop the `@`.
 * - `abandon` — the line no longer starts with `@Name` (edited, deleted,
 *               undone): leave it alone and stop watching.
 */
/**
 * Whether a line-start completion of `name` should keep its `@` pending a
 * verdict — only when `@name:` could actually be parsed as a Carina query
 * (`isCarinaInvocableName`, the parser's own name grammar). `Jean-Luc`, `Zoë`
 * or a one-letter name drop the `@` at once, as they would mid-line.
 */
export function canKeepLineStartAt(name: string): boolean {
  return isCarinaInvocableName(name);
}

export type LineStartMentionVerdict = 'pending' | 'keep' | 'strip' | 'abandon';

export function classifyLineStartMention(line: string, name: string): LineStartMentionVerdict {
  const head = `@${name}`;
  if (!line.startsWith(head)) return 'abandon';
  // A name the Carina parser cannot address never earns a kept `@`.
  if (!canKeepLineStartAt(name)) return 'strip';

  const rest = line.slice(head.length);
  if (rest.length === 0) return 'pending';

  const separator = rest[0];
  if (separator !== ':' && separator !== '?') return 'strip';
  if (rest.length === 1) return 'pending';

  return /\s/.test(rest[1]) ? 'keep' : 'strip';
}
