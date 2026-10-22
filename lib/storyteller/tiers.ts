/**
 * Storyteller bid tiers — what a bid may do once chosen.
 *
 * The server computes a bid's tier from the tools it names (D6): the highest
 * of the tier the character claimed and each named tool's effect. A named
 * built-in or plugin tool counts at its highest possible effect; a named
 * custom tool (`run_custom:<name>`) at its derived effect. A name that was not
 * on the bid's menu is dropped — it could not be used anyway. The claim is
 * only a cross-check: when the tools outrank it the board says so.
 *
 * Pure and client-safe.
 */

import {
  EFFECT_TIER,
  TIER_EFFECT_CEILING,
  type StorytellerTier,
} from '@/lib/schemas/storyteller.types';
import { maxToolEffect, TOOL_EFFECT_RANK, type ToolEffect } from '@/lib/tools/effect-types';
import type { ParsedBid, StorytellerBidOffer } from './types';

/** The custom-tool prefix a bid uses to name one of Pascal's tools. */
export const CUSTOM_TOOL_PREFIX = 'run_custom:';

export interface ComputedBidTier {
  tier: StorytellerTier;
  /** True when the named tools put the bid above what the character claimed. */
  raised: boolean;
  /** Named tools that were on the menu, as given. */
  tools: string[];
  /** Named tools that were not on the menu (dropped). */
  unknownTools: string[];
}

/** The effect of one named tool on a bid's menu, or null when it was not on the menu. */
export function effectOfNamedTool(name: string, offer: StorytellerBidOffer): ToolEffect | null {
  if (name.startsWith(CUSTOM_TOOL_PREFIX)) {
    return offer.customTools[name.slice(CUSTOM_TOOL_PREFIX.length).trim()] ?? null;
  }
  if (name in offer.customTools) return offer.customTools[name];
  return offer.tools[name] ?? null;
}

export function computeBidTier(parsed: ParsedBid, offer: StorytellerBidOffer): ComputedBidTier {
  let toolsEffect: ToolEffect = 'none';
  const tools: string[] = [];
  const unknownTools: string[] = [];
  for (const name of parsed.tools) {
    const effect = effectOfNamedTool(name, offer);
    if (effect === null) {
      unknownTools.push(name);
      continue;
    }
    tools.push(name);
    toolsEffect = maxToolEffect(toolsEffect, effect);
  }

  const stated = parsed.statedTier ?? 'simple';
  const statedEffect = TIER_EFFECT_CEILING[stated];
  const effect = maxToolEffect(statedEffect, toolsEffect);
  const raised = parsed.statedTier !== null && TOOL_EFFECT_RANK[toolsEffect] > TOOL_EFFECT_RANK[statedEffect];
  // A Destroy claim without a destroy tool on the menu has nothing to destroy with.
  const tier = effect === 'destroy' && !offer.destroyOffered ? 'act' : EFFECT_TIER[effect];
  return { tier, raised, tools, unknownTools };
}
