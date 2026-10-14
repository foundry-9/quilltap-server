/**
 * How the Concierge's three states are *shown* — the single source for every
 * word, icon and tone a UI puts on screen.
 *
 * Its sibling, `chat-override.ts`, is the single source for *deriving* a state
 * (and its provenance) from a chat. This module never derives anything; hand
 * it a {@link ConciergeState} — and, for Unmoderated, who put the chat there —
 * and it hands back the presentation.
 *
 * Provenance is a note, never a colour: Unmoderated is one tone whoever set
 * it, and only the helper sentence changes.
 *
 * Client-safe: types only, no server imports, no side effects.
 */

import type { IconName } from '@/components/ui/icons/icon-registry';
import type { ConciergeModeReason } from '@/lib/schemas/chat.types';
import type { ConciergeProvenance, ConciergeState } from './chat-override';

/**
 * The colour families the states speak in. `danger` is the red of the
 * uncensored desk, `muted` the grey of a chat locked to the ordinary desks,
 * `success` the green of a watch being kept. (`info`, the blue of the retired
 * operator-asserted Uncensored state, was removed in phase 4 with its CSS.)
 */
export type ConciergeTone = 'danger' | 'muted' | 'success';

export interface ConciergeStatePresentation {
  /** Short label — badge text, aria-label, tooltip title. */
  label: string;
  /** Canonical icon for the state (the sidebar's icon, the badge's glyph). */
  icon: IconName;
  /** Colour family; see {@link conciergeToneSuffix} and {@link conciergeToneTextClass}. */
  tone: ConciergeTone;
  /** The full "what this means" sentence, in Quilltap's voice. */
  detail: string;
  /** Where to change it; appended to tooltips outside the sidebar. */
  hint: string;
}

/** Where every state is changed from — one sentence, said once. */
const CHANGE_HINT = "Change it from the Salon sidebar's Chat section.";

/**
 * THE table. Three states, three presentations; every badge, mark, icon and
 * helper sentence in the application reads from here, so a copy edit lands
 * everywhere at once. Unmoderated's `detail` is the operator's variant;
 * {@link describeConciergeState} swaps in the Concierge's when he set it.
 */
export const CONCIERGE_STATE_PRESENTATION: Record<ConciergeState, ConciergeStatePresentation> = {
  moderated: {
    label: 'Moderated',
    icon: 'eye',
    tone: 'success',
    detail: 'The Concierge sends everything to the usual providers first, and to the uncensored desk only when one of them refuses. After enough refusals he moves the whole chat himself.',
    hint: CHANGE_HINT,
  },
  unmoderated: {
    label: 'Unmoderated',
    icon: 'eye-off',
    tone: 'danger',
    detail: 'You have opened the uncensored door yourself. Nothing here goes near a moderated provider.',
    hint: CHANGE_HINT,
  },
  locked: {
    label: 'Locked',
    icon: 'shield',
    tone: 'muted',
    detail: 'Only the usual providers, ever. If one refuses, the refusal stands. For the chat that must never reach an uncensored model.',
    hint: CHANGE_HINT,
  },
};

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * The Concierge's own variant of Unmoderated's helper sentence, by why he
 * moved the chat. A migrated chat the classifier had flagged reads as the
 * classifier's.
 */
function conciergeMovedDetail(reason: ConciergeModeReason | null | undefined, refusalCount?: number | null): string {
  if (reason === 'refusals') {
    const n = refusalCount ?? 0;
    const counted = n > 0
      ? ` after ${n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : n} ${n === 1 ? 'refusal' : 'refusals'}`
      : ' after the usual providers refused it';
    return `The Concierge moved this chat to the uncensored desk${counted}. Set it back to Moderated if you disagree.`;
  }
  return 'The Concierge moved this chat to the uncensored desk on reading the conversation. Set it back to Moderated if you disagree.';
}

/**
 * Tone → the class suffix shared by the `qt-danger-badge` and
 * `qt-concierge-mark` families. `danger` is the base rule, so it suffixes with
 * nothing; `success` has no modifier in either family (Moderated draws no badge
 * and no mark) and likewise falls through to the base.
 */
export function conciergeToneSuffix(tone: ConciergeTone): '' | '-muted' {
  if (tone === 'muted') return '-muted';
  return '';
}

/**
 * Tone → the text-colour utility class, for the icons that carry a colour of
 * their own (the sidebar's state glyph). Spelled out one branch at a time
 * rather than interpolated, so `check-qt-classes` can see each class name.
 */
export function conciergeToneTextClass(tone: ConciergeTone): string {
  switch (tone) {
    case 'muted': return 'qt-text-muted';
    case 'success': return 'qt-text-success';
    default: return 'qt-text-danger';
  }
}

/** Everything a tooltip needs, in the order it is read. */
export interface ConciergeStateDescription {
  /** The state's short label — the tooltip's title line. */
  title: string;
  /** The full sentence, in the variant the provenance calls for. */
  detail: string;
  /** The classifier's categories — Unmoderated by the classifier only, and only when it has any. */
  categories: string[] | null;
  /** Where to change the state. */
  hint: string;
}

/** The provenance note a tooltip or helper text needs. */
export interface ConciergeProvenanceNote {
  setBy?: ConciergeProvenance;
  reason?: ConciergeModeReason | null;
  /** Refusals on the ledger — for "after N refusals". */
  refusalCount?: number | null;
}

/**
 * Describe a state for a tooltip, helper text or an accessible summary.
 *
 * Unmoderated picks its sentence by provenance: the operator's own, or the
 * Concierge's with his reason. `dangerCategories` is surfaced only when the
 * classifier's verdict is what moved the chat — they are its reasons; on any
 * other state they are a preserved artefact of an earlier scan.
 */
export function describeConciergeState(
  state: ConciergeState,
  provenance: ConciergeProvenanceNote = {},
  dangerCategories?: string[],
): ConciergeStateDescription {
  const presentation = CONCIERGE_STATE_PRESENTATION[state];
  const byConcierge = state === 'unmoderated' && provenance.setBy === 'concierge';
  const detail = byConcierge
    ? conciergeMovedDetail(provenance.reason, provenance.refusalCount)
    : presentation.detail;
  const categories = byConcierge && provenance.reason !== 'refusals' && dangerCategories && dangerCategories.length > 0
    ? dangerCategories
    : null;

  return {
    title: presentation.label,
    detail,
    categories,
    hint: presentation.hint,
  };
}
