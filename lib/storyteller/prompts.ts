/**
 * Storyteller mode — the two trailing prompt sections.
 *
 * - The **bid** section asks a character whether it wants to speak and what
 *   it plans to do, in the labelled format `bid-parse.ts` reads.
 * - The **plan** section rides on the speaking turn the operator chose: what
 *   the character planned, who has spoken since, that the plan is private, and
 *   which tools this turn allows.
 *
 * Both are trailing sections — appended after recall, progressions and the
 * inform block, never in the system prefix — so a bid shares the character's
 * cached prefix with the speaking turn it may become. Both are ephemeral: they
 * ride in the outgoing request only and are never persisted.
 *
 * Pure.
 */

import { NOTHING_TO_ADD_SENTINEL } from '@/lib/chat/turn-manager/skip-signal';
import { TIER_LABELS, type StorytellerTier } from '@/lib/schemas/storyteller.types';
import type { ToolEffect } from '@/lib/tools/effect-types';
import { CUSTOM_TOOL_PREFIX } from './tiers';
import type { StorytellerBidOffer } from './types';

const NOTE_HEADER = '[Turn note from the Salon — not spoken by any character]';

/** Talkativeness (0.1–1.0) in plain words. */
export function describeDisposition(talkativeness: number): string {
  if (talkativeness < 0.3) {
    return 'You are reserved: you speak when you have something real to add, and are content to let others carry a moment.';
  }
  if (talkativeness < 0.6) {
    return 'You are even-tempered: you speak when the moment invites you, and let it pass when it does not.';
  }
  if (talkativeness < 0.85) {
    return 'You are forthcoming: you are usually glad to take part.';
  }
  return 'You are very talkative: you rarely let a moment pass without a word.';
}

function namesWithEffect(offer: StorytellerBidOffer, effect: ToolEffect): string[] {
  return Object.entries(offer.tools)
    .filter(([, e]) => e === effect)
    .map(([name]) => name)
    .sort();
}

/** The bid section — the last thing a bid call's model reads. */
export function buildBidSection(params: {
  characterName: string;
  talkativeness: number;
  offer: StorytellerBidOffer;
}): string {
  const { characterName, talkativeness, offer } = params;
  const readTools = namesWithEffect(offer, 'read');
  const customEntries = Object.entries(offer.customTools).sort(([a], [b]) => a.localeCompare(b));

  const tiers: string[] = [
    '- simple: just speak or act in character, using no tools.',
    readTools.length > 0
      ? `- lookup: look things up first with read-only tools, then speak. Read-only tools: ${readTools.join(', ')}.`
      : '- lookup: look things up first with read-only tools, then speak.',
    '- act: do something that changes the world (write a document, change clothes, move an object, send a letter, run a tool with effects), then speak.',
  ];
  if (offer.destroyOffered) {
    tiers.push(`- destroy: delete something (${namesWithEffect(offer, 'destroy').join(', ')}). Only when deletion is truly the point.`);
  }

  const lines: string[] = [
    NOTE_HEADER,
    `This is not your turn yet. The storyteller is asking each character whether they want to respond to what just happened, and will choose who goes ahead. Do not write your reply now — answer only with your bid.`,
    '',
    describeDisposition(talkativeness),
  ];
  if (offer.silent) {
    lines.push('You are silent in this scene: if you go ahead, you may only act or emote, not speak aloud.');
  }
  lines.push('', 'How much do you mean to do? Pick one tier:', ...tiers);
  if (customEntries.length > 0) {
    lines.push(
      '',
      `Custom tools you can run (name them as ${CUSTOM_TOOL_PREFIX}<name>), with what each does to the world:`,
      ...customEntries.map(([name, effect]) => `- ${name}: ${effect === 'read' ? 'read (lookup tier)' : 'write (act tier)'}`)
    );
  }
  lines.push(
    '',
    'Reply with exactly these four lines and nothing else:',
    'BID: speak or pass',
    `TIER: ${offer.destroyOffered ? 'simple, lookup, act or destroy' : 'simple, lookup or act'}`,
    'TOOLS: the tools you plan to use, comma-separated, or none',
    `PLAN: one or two sentences, in ${characterName}'s own words, of what you mean to say or do`,
    '',
    'Pass if you have nothing worth adding. Do not call any tool now.'
  );
  return lines.join('\n');
}

/** The plan section — rides on the speaking turn the operator chose. */
export function buildPlanSection(params: {
  plan: string;
  tier: StorytellerTier;
  toolsNamed: string[];
  spokenSince: string[];
  allowedTools: string[];
  /**
   * A swipe re-rolls a line that was already chosen and spoken: it runs with
   * no tools and may not pass, so neither is offered.
   */
  reroll?: boolean;
}): string {
  const { plan, tier, toolsNamed, spokenSince, allowedTools, reroll } = params;
  if (reroll) {
    return [
      NOTE_HEADER,
      'The storyteller chose you to go ahead. When you were asked, you planned this:',
      '',
      `"${plan}"`,
      '',
      'The plan is private: do not announce it, quote it, or mention that you made one. You may adapt it to the moment.',
    ].join('\n');
  }
  const lines: string[] = [
    NOTE_HEADER,
    'The storyteller chose you to go ahead. When you were asked, you planned this:',
    '',
    `"${plan}"`,
    '',
    spokenSince.length > 0
      ? `Since you planned it, ${joinNames(spokenSince)} ${spokenSince.length === 1 ? 'has' : 'have'} spoken. Read what they said before you answer.`
      : 'Nobody has spoken since you planned it.',
    'The plan is private: do not announce it, quote it, or mention that you made one.',
    'You may adapt it to the moment. If the moment for it has gone, reply with exactly this single line and nothing else:',
    '',
    NOTHING_TO_ADD_SENTINEL,
    '',
    tierAllowance(tier, allowedTools),
  ];
  if (toolsNamed.length > 0) {
    lines.push(`You mentioned: ${toolsNamed.join(', ')}.`);
  }
  return lines.join('\n');
}

function tierAllowance(tier: StorytellerTier, allowedTools: string[]): string {
  const label = TIER_LABELS[tier];
  if (tier === 'simple') return `Your bid was ${label}: this turn allows no tools. Just speak or act.`;
  const list = allowedTools.length > 0 ? ` Tools available: ${allowedTools.join(', ')}.` : '';
  switch (tier) {
    case 'lookup':
      return `Your bid was ${label}: this turn allows read-only tools; anything that changes the world will be refused.${list}`;
    case 'act':
      return `Your bid was ${label}: this turn allows tools that look things up or change the world, but not deletion.${list}`;
    case 'destroy':
      return `Your bid was ${label}: this turn allows every tool, deletion included.${list}`;
  }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
