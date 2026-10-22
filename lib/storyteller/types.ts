/**
 * Storyteller mode — server-side shapes shared by the round service, the bid
 * service and the turn path. The persisted shapes live in
 * `lib/schemas/storyteller.types.ts`.
 */

import type { ToolEffect } from '@/lib/tools/effect-types';
import type { StorytellerBidRecord, StorytellerTier } from '@/lib/schemas/storyteller.types';

/** What the turn path needs to run one storyteller speaking turn. */
export interface StorytellerTurnContext {
  /** The bid this turn carries out; stored on the message. */
  bidRecord: StorytellerBidRecord;
  /** The tier's ceiling. */
  effectCeiling: ToolEffect;
  /** Display names of everyone who has spoken since this bid was made (sequential order). */
  spokenSince: string[];
  /**
   * A concurrent turn other than the group's first: it skips the
   * once-per-cadence public Prospero context announcement, which every turn
   * of the group would otherwise post from the same message count.
   */
  concurrentFollower?: boolean;
}

/** Asks the turn path to build a bid instead of a turn (dry; no stream, no save). */
export interface StorytellerBidRequest {
  roundId: string;
}

/** The raw outcome of one bid call, before it becomes a board card. */
export type StorytellerBidCallOutcome =
  | {
      ok: true;
      /** The model's text, as returned. */
      text: string;
      /** Tool names the provider returned calls for anyway (discarded). */
      discardedToolCalls: string[];
      /** What the bid prompt offered, for computing the tier. */
      offered: StorytellerBidOffer;
    }
  | { ok: false; reason: string };

/** The menu a bid prompt offered one character. */
export interface StorytellerBidOffer {
  /** Built-in / plugin tool name → highest possible effect. */
  tools: Record<string, ToolEffect>;
  /** Custom tool name → derived effect. */
  customTools: Record<string, ToolEffect>;
  /** Whether any `destroy` tool was on the menu (the Destroy tier is offered only then). */
  destroyOffered: boolean;
  silent: boolean;
}

/** A parsed bid reply. */
export interface ParsedBid {
  speak: boolean;
  statedTier: StorytellerTier | null;
  tools: string[];
  plan: string | null;
}
