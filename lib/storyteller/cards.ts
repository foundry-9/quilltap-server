/**
 * Storyteller — turning one bid call's outcome into a board card.
 *
 * Pure: a failed call is an `error` card, an unreadable reply or a declined
 * bid a `pass`, and a bid to speak a `bid` card whose tier the server
 * computed from the tools it named (`tiers.ts`).
 */

import type { StorytellerBid } from '@/lib/schemas/storyteller.types';
import { parseBidReply } from './bid-parse';
import { computeBidTier } from './tiers';
import type { StorytellerBidCallOutcome } from './types';

/** Turn one bid call's outcome into a board card. Pure. */
export function cardFromOutcome(
  base: StorytellerBid,
  outcome: StorytellerBidCallOutcome,
  answeredAt: string = new Date().toISOString()
): StorytellerBid {
  if (!outcome.ok) {
    return { ...base, status: 'error', reason: outcome.reason, answeredAt };
  }
  const parsed = parseBidReply(outcome.text);
  if (!parsed) {
    return { ...base, status: 'pass', reason: 'No bid could be read from the reply', answeredAt };
  }
  if (!parsed.speak) {
    return { ...base, status: 'pass', plan: parsed.plan, reason: parsed.plan ? null : 'Passed', answeredAt };
  }
  const computed = computeBidTier(parsed, outcome.offered);
  return {
    ...base,
    status: 'bid',
    statedTier: parsed.statedTier,
    tier: computed.tier,
    tierRaised: computed.raised,
    tools: computed.tools,
    plan: parsed.plan ?? '(no plan given)',
    reason: computed.unknownTools.length > 0 ? `Named tools it does not have: ${computed.unknownTools.join(', ')}` : null,
    answeredAt,
  };
}

