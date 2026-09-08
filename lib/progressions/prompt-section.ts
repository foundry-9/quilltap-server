/**
 * Character progressions — the prompt-side chokepoint.
 *
 * Every prompt path that reports a character's timed conditions comes through
 * `buildProgressionsSection`, and nowhere else re-derives elapsed / remaining /
 * percent. The engine below it is pure and client-safe; this module is the
 * server-side wrapper that adds the two things the engine deliberately has no
 * business knowing: the cadence input (the character's own last turn, walked
 * out of the event history) and the debug logging every backend path owes.
 *
 * ## Where the section lands
 *
 * Never in system block 1. The identity stack and `buildSystemPrompt` are the
 * CACHED prefix; a per-turn clock inside them would bisect the cache on every
 * single turn, break the golden hash in the cache-determinism suite and sink
 * the 30-turn stability eval. The report is a **trailing per-turn section** on
 * the uncached tail, after Suparṇā's mail and before the turn-skip note, and
 * it is not persisted as a message: it is recomputed every turn, and a
 * transcript whisper per turn for a `turn`-cadence weapon would be noise.
 *
 * ## Empty is byte-for-byte nothing
 *
 * When no progression reports this turn the function returns `''` and the
 * caller pushes nothing — the empty-is-identical guarantee every trailing
 * section keeps, and the reason a character with no progressions sees a prompt
 * indistinguishable from one built before this feature existed.
 *
 * That guarantee extends to the READ: `loadEvents` is a thunk, called only
 * once a character is known to carry at least one progression. A character
 * carrying none costs this feature exactly nothing — not a query, not a row —
 * which is the overwhelmingly common case and the one a per-turn addition has
 * no business taxing.
 */

import { logger } from '@/lib/logger';
import { findLastOwnTurnMs } from '@/lib/chat/context/core-whisper-trigger';
import type { ChatEvent } from '@/lib/schemas/chat.types';

import {
  deriveProgression,
  parseProgressions,
  renderProgressionReport,
  shouldReportProgression,
  type ReportReason,
} from './engine';

const CONTEXT = 'progressions.prompt-section';

/** The wrapper sentence the report block opens with. Second person, no Staff persona. */
export const PROGRESSIONS_SECTION_HEADER = 'Time-bound conditions you are carrying, as of this moment:';

export interface BuildProgressionsSectionParams {
  /** The responding character, hydrated — `metadata` comes from the read overlay. */
  character: { id: string; metadata?: unknown } | null | undefined;
  /**
   * This chat's events, for the cadence walk — as a THUNK, so a character with
   * no progressions never triggers the read. Ignored when `force` is set.
   */
  loadEvents?: () => Promise<ChatEvent[]>;
  /** The responding participant, whose own last turn sets the cadence. */
  respondingParticipantId?: string | null;
  /** The wall clock, injected. */
  nowMs: number;
  /** The chat's resolved timezone, for `{{start}}` / `{{end}}`. */
  timezone?: string;
  /**
   * Report everything, cadence notwithstanding — the greeting builder and
   * Carina, both of which are one-shot prompts with no "last turn" to speak of.
   * An opener should know she is pregnant.
   */
  force?: boolean;
}

/**
 * Build the trailing progressions section for one turn, or `''` when nothing
 * reports. Never throws: a character's timed conditions are a garnish on a
 * turn, and no malformed entry may cost them the turn itself.
 */
export async function buildProgressionsSection(
  params: BuildProgressionsSectionParams,
): Promise<string> {
  const { character, loadEvents, respondingParticipantId, nowMs, timezone, force = false } = params;

  if (!character) return '';

  try {
    const progressions = parseProgressions(character.metadata, (id, issue) => {
      logger.warn('Dropping a malformed character progression', {
        context: CONTEXT,
        characterId: character.id,
        progressionId: id,
        issue,
      });
    });

    const ids = Object.keys(progressions);
    if (ids.length === 0) return '';

    // Cadence input: the character's own most recent visible turn here. A
    // forced build skips the walk entirely — there is no history to consult on
    // a greeting, and `null` is what "report everything" means to the engine.
    const lastTurnMs =
      force || !loadEvents || !respondingParticipantId
        ? null
        : findLastOwnTurnMs(await loadEvents(), respondingParticipantId);

    const lines: string[] = [];
    const decisions: Array<{ id: string; state: string; reason: ReportReason }> = [];

    for (const id of ids.sort()) {
      const p = progressions[id];
      const derived = deriveProgression(id, p, nowMs);
      const { report, reason } = force
        ? ({ report: true, reason: 'first' } as const)
        : shouldReportProgression(p, derived, lastTurnMs);

      decisions.push({ id, state: derived.state, reason });
      if (report) lines.push(`- ${renderProgressionReport(p, derived, { timezone })}`);
    }

    const section = lines.length > 0 ? `${PROGRESSIONS_SECTION_HEADER}\n${lines.join('\n')}` : '';

    logger.debug('Character progressions evaluated for this turn', {
      context: CONTEXT,
      characterId: character.id,
      respondingParticipantId: respondingParticipantId ?? null,
      lastTurnMs,
      forced: force,
      emitted: section !== '',
      reported: lines.length,
      decisions,
    });

    return section;
  } catch (error) {
    logger.warn('Progressions section failed to build; the turn continues without it', {
      context: CONTEXT,
      characterId: character.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
