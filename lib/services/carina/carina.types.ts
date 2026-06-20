/**
 * Carina (inline LLM queries) — shared types.
 *
 * Carina routes an `@Name:` / `@Name?` query (or an `ask_carina` tool call) to a
 * designated answerer character and produces a minimal, isolated reference
 * answer. Failures are returned (never thrown) so the caller can route them
 * through Prospero.
 */

import type { MessageEvent } from '@/lib/schemas/types';

/** The failure that prevented a Carina query from being answered. */
export type CarinaErrorKind = 'not-found' | 'no-profile' | 'llm-failed';

export interface CarinaError {
  kind: CarinaErrorKind;
  /** Short summary for the `llm-failed` case (network/rate-limit/etc.). */
  detail?: string;
  /** The resolved answerer's name, when known (null for `not-found`). */
  characterName?: string | null;
}

export type CarinaResult =
  | {
      ok: true;
      /** The answerer's reply text. Also returned to a calling LLM as a tool result. */
      answer: string;
      /** The posted Carina message's id. */
      messageId: string;
      /**
       * The posted Carina message itself, so a caller (e.g. the orchestrator's
       * user-message hook) can splice it into the current turn's in-memory
       * context — letting the first same-cycle responder hear a PUBLIC answer.
       */
      message: MessageEvent;
      /** The resolved answerer character's id and name. */
      answererId: string;
      answererName: string;
    }
  | { ok: false; error: CarinaError };
