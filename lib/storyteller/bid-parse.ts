/**
 * Storyteller bid replies — the forgiving parser.
 *
 * A bid is a short labelled text block:
 *
 *   BID: speak | pass
 *   TIER: simple | lookup | act | destroy
 *   TOOLS: doc_read_file, run_custom:entanglement_scan
 *   PLAN: One or two sentences of what they mean to say or do.
 *
 * Parsed as forgivingly as the turn sentinels in `skip-signal.ts`: labels in
 * any case, wrapped in markdown emphasis or a code fence, in any order, with
 * `:` or `-` or `=`; a plan that runs onto following lines. Anything
 * unparseable is a pass (the raw text stays in the LLM log).
 *
 * Pure and client-safe.
 */

import { STORYTELLER_TIERS, type StorytellerTier } from '@/lib/schemas/storyteller.types';
import type { ParsedBid } from './types';

const LABELS = ['BID', 'TIER', 'TOOLS', 'PLAN'] as const;
type Label = (typeof LABELS)[number];

const LABEL_LINE = /^\s*(?:[-*>]\s*)?[*_`~]*\s*(BID|TIER|TOOLS?|PLAN)\s*[*_`~]*\s*[:=\-–—]\s*(.*)$/i;

const TIER_SYNONYMS: Record<string, StorytellerTier> = {
  simple: 'simple',
  reply: 'simple',
  speak: 'simple',
  lookup: 'lookup',
  'look up': 'lookup',
  read: 'lookup',
  act: 'act',
  action: 'act',
  write: 'act',
  destroy: 'destroy',
  delete: 'destroy',
};

function stripWrapping(value: string): string {
  return value.replace(/^[\s*_`~"'[\]]+|[\s*_`~"'[\].]+$/g, '').trim();
}

export function parseBidReply(raw: string): ParsedBid | null {
  if (!raw || !raw.trim()) return null;
  const fields: Partial<Record<Label, string>> = {};
  let current: Label | null = null;

  for (const line of raw.replace(/```[a-z]*\n?/gi, '').split(/\r?\n/)) {
    const match = LABEL_LINE.exec(line);
    if (match) {
      const label = match[1].toUpperCase();
      current = (label === 'TOOL' ? 'TOOLS' : label) as Label;
      fields[current] = match[2].trim();
      continue;
    }
    // Continuation lines belong to the plan; anything else before a label is ignored.
    if (current === 'PLAN' && line.trim()) {
      fields.PLAN = `${fields.PLAN ?? ''} ${line.trim()}`.trim();
    }
  }

  if (fields.BID === undefined) return null;
  const bidWord = stripWrapping(fields.BID).toLowerCase();
  const speak = /^(speak|yes|bid|respond|reply|act)\b/.test(bidWord);
  const passes = /^(pass|no|none|decline|skip)\b/.test(bidWord);
  if (!speak && !passes) return null;

  const tierWord = fields.TIER ? stripWrapping(fields.TIER).toLowerCase() : '';
  const statedTier =
    (STORYTELLER_TIERS as readonly string[]).includes(tierWord)
      ? (tierWord as StorytellerTier)
      : (Object.entries(TIER_SYNONYMS).find(([word]) => tierWord.startsWith(word))?.[1] ?? null);

  const toolsText = fields.TOOLS ? stripWrapping(fields.TOOLS) : '';
  const tools = /^(none|n\/a|-|—)?$/i.test(toolsText)
    ? []
    : toolsText
        .split(/[,;]|\s+and\s+/)
        .map((tool) => stripWrapping(tool).replace(/\(\)$/, ''))
        .filter((tool) => tool.length > 0 && !/^none$/i.test(tool));

  const plan = fields.PLAN ? fields.PLAN.replace(/^[\s*_`~"]+|[\s*_`~"]+$/g, '').trim() || null : null;

  return { speak, statedTier, tools: [...new Set(tools)], plan };
}
