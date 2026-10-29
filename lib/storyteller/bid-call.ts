/**
 * Storyteller bid — the menu offered and the one LLM call.
 *
 * The bid call is a full in-character call: the same connection profile,
 * identity stack, recall and transcript as a real turn (the turn path builds
 * it with `purpose: 'bid'`), with the bid section trailing. The same tool list
 * is sent with tool choice "none", so the request shares the character's
 * cached prefix and warms it for the speaking turn; a provider that calls a
 * tool anyway has the call discarded. The call is logged as `STORYTELLER_BID`.
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { streamMessage, type StreamOptions } from '@/lib/services/chat-message/streaming.service';
import { maxEffectOfTool, type ToolEffect } from '@/lib/tools/effects';
import type { StorytellerBidCallOutcome, StorytellerBidOffer } from './types';

const logger = createServiceLogger('StorytellerBidCall');

/** Tools never listed on a bid's menu: `run_custom` is listed by custom tool instead. */
const UNLISTED_TOOLS = new Set(['run_custom', 'submit_final_response']);

function toolName(tool: unknown): string | undefined {
  const t = tool as { function?: { name?: string }; name?: string };
  return t.function?.name || t.name;
}

/** The menu one character's bid is offered, from the tools its turn would get. */
export function buildBidOffer(params: {
  tools: unknown[];
  customToolEffects: ReadonlyMap<string, ToolEffect>;
  pluginToolEffects: ReadonlyMap<string, ToolEffect>;
  silent: boolean;
}): StorytellerBidOffer {
  const tools: Record<string, ToolEffect> = {};
  let hasRunCustom = false;
  for (const tool of params.tools) {
    const name = toolName(tool);
    if (!name) continue;
    if (name === 'run_custom') hasRunCustom = true;
    if (UNLISTED_TOOLS.has(name)) continue;
    tools[name] = maxEffectOfTool(name, { pluginToolEffects: params.pluginToolEffects });
  }
  const customTools: Record<string, ToolEffect> = {};
  if (hasRunCustom) {
    for (const [name, effect] of params.customToolEffects) customTools[name] = effect;
  }
  return {
    tools,
    customTools,
    destroyOffered: Object.values(tools).includes('destroy'),
    silent: params.silent,
  };
}

/** Make the one bid call and collect its text. Never throws. */
export async function callForBid(
  options: Omit<StreamOptions, 'logType' | 'toolChoice'>,
  offer: StorytellerBidOffer
): Promise<StorytellerBidCallOutcome> {
  let text = '';
  try {
    for await (const chunk of streamMessage({ ...options, logType: 'STORYTELLER_BID', toolChoice: 'none' })) {
      if (chunk.content) text += chunk.content;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn('Storyteller bid call failed', {
      chatId: options.chatId,
      characterId: options.characterId,
      error: reason,
    });
    return { ok: false, reason };
  }
  logger.debug('Storyteller bid call returned', {
    chatId: options.chatId,
    characterId: options.characterId,
    length: text.length,
  });
  return { ok: true, text, discardedToolCalls: [], offered: offer };
}
