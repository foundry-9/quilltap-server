/**
 * Storyteller mode — schemas.
 *
 * In a storyteller chat each operator post opens a **round**: every invited
 * LLM character is asked, in parallel, for a **bid** (a plan, not a turn), and
 * the operator picks which bids go ahead. The chosen characters then speak,
 * each limited to the **tier** it bid.
 *
 * A round lives in `storyteller_rounds` while it is open; its bids are cleared
 * when it closes (they stay in the LLM log). The bid a speaking turn carried
 * out is stored on that message as `storytellerBid`, which IS part of the
 * record. Design of record: docs/developer/features/complete/storyteller-mode.md.
 *
 * Client-safe: no server imports.
 */

import { z } from 'zod';
import type { ToolEffect } from '@/lib/tools/effect-types';

/** A chat's turn mode. NULL in storage reads as `rotation`. */
export const ChatTurnModeSchema = z.enum(['rotation', 'storyteller']);
export type ChatTurnMode = z.infer<typeof ChatTurnModeSchema>;

/** The tiers a bid may claim, lowest first. */
export const StorytellerTierSchema = z.enum(['simple', 'lookup', 'act', 'destroy']);
export type StorytellerTier = z.infer<typeof StorytellerTierSchema>;

export const STORYTELLER_TIERS: readonly StorytellerTier[] = StorytellerTierSchema.options;

/** The effect ceiling each tier grants a speaking turn. */
export const TIER_EFFECT_CEILING: Record<StorytellerTier, ToolEffect> = {
  simple: 'none',
  lookup: 'read',
  act: 'write',
  destroy: 'destroy',
};

/** The tier a tool effect requires. */
export const EFFECT_TIER: Record<ToolEffect, StorytellerTier> = {
  none: 'simple',
  read: 'lookup',
  write: 'act',
  destroy: 'destroy',
};

export const TIER_LABELS: Record<StorytellerTier, string> = {
  simple: 'Simple',
  lookup: 'Lookup',
  act: 'Act',
  destroy: 'Destroy',
};

/** What became of one invited seat's bid. */
export const StorytellerBidStatusSchema = z.enum([
  /** Asked; no answer yet. */
  'pending',
  /** Wants to speak. */
  'bid',
  /** Declined, or said nothing parseable. */
  'pass',
  /** The call failed or was refused — shown as a pass with a reason. */
  'error',
  /** Not invited this round (the talkativeness filter); the operator may ask anyway. */
  'kept-quiet',
]);
export type StorytellerBidStatus = z.infer<typeof StorytellerBidStatusSchema>;

/** One seat's card on the board. */
export const StorytellerBidSchema = z.object({
  participantId: z.string(),
  characterId: z.string(),
  characterName: z.string(),
  status: StorytellerBidStatusSchema,
  /** The tier the character claimed. */
  statedTier: StorytellerTierSchema.nullable().optional(),
  /** The tier the server computed: the highest of the claim and the named tools' effects. */
  tier: StorytellerTierSchema.nullable().optional(),
  /** The named tools put the bid above what the character claimed. */
  tierRaised: z.boolean().default(false),
  /** Tools the character named, as intent (`run_custom:<name>` for a custom tool). */
  tools: z.array(z.string()).default([]),
  /** One or two sentences of what they mean to do. Private to the board. */
  plan: z.string().nullable().optional(),
  /** Why a pass or error is one. */
  reason: z.string().nullable().optional(),
  /** The talkativeness the seat was weighed with. */
  talkativeness: z.number(),
  /** Silent seat: may only act or emote. */
  silent: z.boolean().default(false),
  askedAt: z.string().nullable().optional(),
  answeredAt: z.string().nullable().optional(),
});
export type StorytellerBid = z.infer<typeof StorytellerBidSchema>;

export const StorytellerOrderSchema = z.enum(['sequential', 'simultaneous']);
export type StorytellerOrder = z.infer<typeof StorytellerOrderSchema>;

export const StorytellerSelectionSchema = z.object({
  participantIds: z.array(z.string()),
  order: StorytellerOrderSchema.nullable(),
  chosenAt: z.string(),
  /** Display names in chosen order, kept for the one-line summary after the bids are cleared. */
  names: z.array(z.string()).default([]),
});
export type StorytellerSelection = z.infer<typeof StorytellerSelectionSchema>;

export const StorytellerRoundStatusSchema = z.enum(['open', 'running', 'closed']);
export type StorytellerRoundStatus = z.infer<typeof StorytellerRoundStatusSchema>;

export const StorytellerRoundSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  /** The operator post that opened the round. */
  triggerMessageId: z.string().nullable(),
  status: StorytellerRoundStatusSchema,
  bids: z.array(StorytellerBidSchema).default([]),
  selection: StorytellerSelectionSchema.nullable().optional(),
  /** Why it closed: run, let lie, superseded by a new post, or abandoned. */
  closedReason: z.enum(['ran', 'let-lie', 'superseded', 'abandoned']).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable().optional(),
});
export type StorytellerRound = z.infer<typeof StorytellerRoundSchema>;

/**
 * The bid a speaking turn carried out, stored on its message
 * (`chat_messages.storytellerBid`). A swipe or regenerate re-applies it, so a
 * re-roll runs under the same plan and ceiling. Never model-facing.
 */
export const StorytellerBidRecordSchema = z.object({
  roundId: z.string(),
  tier: StorytellerTierSchema,
  plan: z.string(),
  toolsNamed: z.array(z.string()).default([]),
});
export type StorytellerBidRecord = z.infer<typeof StorytellerBidRecordSchema>;

/** Body of `POST /api/v1/chats/[id]?action=storyteller-run`. */
export const StorytellerRunRequestSchema = z.object({
  roundId: z.string(),
  participantIds: z.array(z.string()),
  order: StorytellerOrderSchema.optional(),
});

/** Body of `POST /api/v1/chats/[id]?action=storyteller-ask`. */
export const StorytellerAskRequestSchema = z.object({
  roundId: z.string(),
  participantId: z.string(),
});
