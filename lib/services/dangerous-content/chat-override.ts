/**
 * Per-chat Concierge helpers — the single source of truth for a chat's
 * Concierge posture.
 *
 * A chat is in one of three states, stored in `chats.conciergeMode`:
 *
 *   | State         | Text / cheap LLM / images   | Failover on refusal | Concierge may move it |
 *   | 'moderated'   | ordinary providers first    | yes                 | yes (to Unmoderated)  |
 *   | 'unmoderated' | the uncensored desk only    | n/a (already there) | n/a                   |
 *   | 'locked'      | ordinary providers only     | never               | never                 |
 *
 * Who put the chat in its state — the operator, or the Concierge after
 * refusals or on the classifier's reading — is *provenance*
 * (`conciergeModeSetBy` / `conciergeModeReason`). It is a note on the badge
 * and in the helper text, never a separate state and never a colour.
 *
 * The legacy pair (`conciergeOverride`, `isDangerousChat`) is no longer read
 * by any routing or display decision. `isDangerousChat` and its siblings are
 * the classifier's telemetry; `conciergeOverride` is not written at all.
 * {@link deriveConciergeModeFromLegacy} maps an old row or an old bundle onto
 * the three states, and is used only where such data enters (the migration's
 * mirror, the importer, the restore).
 *
 * NOTHING outside this module (and the sanctioned writer, `applyConciergeFlip`)
 * should read the stored columns. Derive everything from
 * {@link getConciergeState}, or ask one of the purpose-named questions:
 *
 *   - "Take the uncensored routes right now?" → {@link shouldUseUncensoredRoute}
 *     (or {@link conciergeStateUsesUncensoredRoute}, given a derived state)
 *   - "Paint danger styling in the UI?"        → {@link shouldShowDangerStyling}
 *   - "May the Concierge move this chat?"      → {@link isClassifierOnDuty}
 *   - "May a refusal be rerouted?"             → {@link mayFailOver}
 *     (or {@link conciergeStateMayFailOver}, given a derived state)
 */

import type {
  ConciergeMode,
  ConciergeModeReason,
  ConciergeModeSetBy,
} from '@/lib/schemas/chat.types';

/** The stored legacy `chats.conciergeOverride` domain. No longer written. */
export type ConciergeOverrideValue = 'OFF' | 'UNCENSORED';

/**
 * The canonical Concierge state of a chat. The string values are also the
 * wire contract of `conciergeState` on `PUT /api/v1/chats/[id]` and
 * `POST /api/v1/chats`.
 */
export type ConciergeState = ConciergeMode;

/** Who put the chat in its state; `null` when it is Moderated by default. */
export type ConciergeProvenance = ConciergeModeSetBy | null;

/** Every state, in the order the controls list them. */
export const CONCIERGE_STATES: readonly ConciergeState[] = ['moderated', 'unmoderated', 'locked'];

/**
 * A chat row (the stored columns) or a chat payload the server already
 * derived (`GET /api/v1/chats/[id]` carries `conciergeState` /
 * `conciergeSetBy` / `conciergeReason`, never the columns). The helpers below
 * read whichever is present, columns first, so client and server ask the same
 * functions.
 */
type ChatLike = {
  conciergeMode?: ConciergeMode | null;
  conciergeModeSetBy?: ConciergeModeSetBy | null;
  conciergeModeReason?: ConciergeModeReason | null;
  conciergeState?: ConciergeState | null;
  conciergeSetBy?: ConciergeModeSetBy | null;
  conciergeReason?: ConciergeModeReason | null;
};

/**
 * THE canonical derivation of a chat's Concierge state. A missing or NULL
 * column reads as `'moderated'`.
 */
export function getConciergeState(chat: ChatLike | null | undefined): ConciergeState {
  const mode = chat?.conciergeMode ?? chat?.conciergeState;
  return mode === 'unmoderated' || mode === 'locked' ? mode : 'moderated';
}

/**
 * Who put the chat in its current state. Always `null` for a Moderated chat —
 * Moderated is where every chat starts and where the operator returns it, so
 * there is nothing to attribute.
 */
export function getConciergeProvenance(chat: ChatLike | null | undefined): ConciergeProvenance {
  if (getConciergeState(chat) === 'moderated') return null;
  const by = chat?.conciergeModeSetBy ?? chat?.conciergeSetBy;
  return by === 'concierge' || by === 'operator' ? by : 'operator';
}

/** Why the chat is in its current state; `null` for a Moderated chat. */
export function getConciergeReason(chat: ChatLike | null | undefined): ConciergeModeReason | null {
  if (getConciergeState(chat) === 'moderated') return null;
  return chat?.conciergeModeReason ?? chat?.conciergeReason ?? null;
}

/**
 * Does this state take the uncensored route? The state-only twin of
 * {@link shouldUseUncensoredRoute}, for callers that already hold a derived
 * state (list payloads carry `conciergeState` rather than the columns). THE
 * one place that says which state takes the uncensored route.
 */
export function conciergeStateUsesUncensoredRoute(state: ConciergeState): boolean {
  return state === 'unmoderated';
}

/**
 * Should this chat take the Concierge's uncensored routes right now — reroute
 * providers, pick candid over concealed prompt guidance, select an
 * uncensored cheap LLM? True only for Unmoderated, whoever set it.
 */
export function shouldUseUncensoredRoute(chat: ChatLike | null | undefined): boolean {
  return conciergeStateUsesUncensoredRoute(getConciergeState(chat));
}

/**
 * Should the UI paint this chat with danger styling? True for Unmoderated,
 * regardless of provenance: the provenance goes in the tooltip and helper
 * text, never in colour.
 */
export function shouldShowDangerStyling(chat: ChatLike | null | undefined): boolean {
  return getConciergeState(chat) === 'unmoderated';
}

/**
 * May the Concierge act on this chat of his own accord — the classifier job,
 * the scheduled scan, the per-turn trigger and the refusal ledger's
 * auto-switch? True only for Moderated: an Unmoderated chat has nowhere
 * further to go, and a Locked one is the operator's to keep.
 */
export function isClassifierOnDuty(chat: ChatLike | null | undefined): boolean {
  return getConciergeState(chat) === 'moderated';
}

/**
 * May a refusal in this state be rerouted to an uncensored understudy? The
 * state-only twin of {@link mayFailOver}. False only for Locked, which must
 * never reach the uncensored desk. Moderated fails over by design; an
 * Unmoderated chat is already on the uncensored desk, and should one of its
 * profiles still refuse, trying another costs nothing it has not already
 * chosen.
 */
export function conciergeStateMayFailOver(state: ConciergeState): boolean {
  return state !== 'locked';
}

/**
 * May a refusal on this chat be rerouted to an uncensored understudy? Asked by
 * the phase-1 failover chokepoints before they consult the Concierge mode. A
 * chatless call (no chat to ask) reads as Moderated.
 */
export function mayFailOver(chat: ChatLike | null | undefined): boolean {
  return conciergeStateMayFailOver(getConciergeState(chat));
}

/** The three stored columns that make up a chat's Concierge posture. */
export interface ConciergeModeColumns {
  conciergeMode: ConciergeMode;
  conciergeModeSetBy: ConciergeModeSetBy | null;
  conciergeModeReason: ConciergeModeReason | null;
}

/**
 * Map the legacy pair onto the three states. The same table the
 * `add-chat-concierge-mode-v1` migration applies in SQL:
 *
 *   | conciergeOverride | isDangerousChat | → mode        | setBy     | reason     |
 *   | 'UNCENSORED'      | any             | 'unmoderated' | operator  | migration  |
 *   | 'OFF'             | any             | 'locked'      | operator  | migration  |
 *   | NULL              | true            | 'unmoderated' | concierge | classifier |
 *   | NULL              | else            | 'moderated'   | NULL      | NULL       |
 */
export function deriveConciergeModeFromLegacy(legacy: {
  conciergeOverride?: ConciergeOverrideValue | string | null;
  isDangerousChat?: boolean | null;
}): ConciergeModeColumns {
  if (legacy.conciergeOverride === 'UNCENSORED') {
    return { conciergeMode: 'unmoderated', conciergeModeSetBy: 'operator', conciergeModeReason: 'migration' };
  }
  if (legacy.conciergeOverride === 'OFF') {
    return { conciergeMode: 'locked', conciergeModeSetBy: 'operator', conciergeModeReason: 'migration' };
  }
  if (legacy.isDangerousChat === true) {
    return { conciergeMode: 'unmoderated', conciergeModeSetBy: 'concierge', conciergeModeReason: 'classifier' };
  }
  return { conciergeMode: 'moderated', conciergeModeSetBy: null, conciergeModeReason: null };
}

/**
 * For data entering from outside (an import bundle, a backup): a chat that
 * carries no `conciergeMode` predates phase 3, so derive it from the legacy
 * pair. A chat that carries one is returned unchanged.
 */
export function withConciergeModeFromLegacy<T extends ChatLike & {
  conciergeOverride?: ConciergeOverrideValue | string | null;
  isDangerousChat?: boolean | null;
}>(chat: T): T {
  if (chat.conciergeMode != null) return chat;
  return { ...chat, ...deriveConciergeModeFromLegacy(chat) };
}
