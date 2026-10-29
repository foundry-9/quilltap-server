/**
 * Trigger phrases — the scanner.
 *
 * A custom tool may declare `triggers`: phrases that, said by anyone in the
 * chat, run the tool with every parameter at its default (see
 * `lib/pascal/trigger-runner.ts`, and the design of record in
 * docs/developer/features/complete/pascal-trigger-phrases.md).
 *
 * The semantics are deliberately the plainest available: a case-insensitive
 * substring test, no word boundaries, no regex, no stemming. `"fire"` matches
 * `"fireplace"`; an author who wants precision writes a longer phrase. There is
 * nothing to parse and nothing to get wrong.
 *
 * Pure and client-safe — the Workbench reuses the folding for its self-echo
 * warning.
 */

import type { QtapCustomTool } from './custom-tool.types';
import { stripCarinaQueryLines } from '@/lib/chat/carina-parser';

/**
 * Most tools one message may fire. Each run may consult a model and posts a
 * message; an author who lists common words in eight tools should not spend
 * eight LLM calls per sentence. Over the cap, the rest are returned as
 * `dropped` for the caller to log — never silently truncated.
 */
export const MAX_TRIGGER_RUNS_PER_MESSAGE = 4;

export interface TriggerHit {
  /** The tool's `name`. */
  tool: string;
  /** The phrase as written in the definition. */
  phrase: string;
  /** Offset of the match in the scanned text — for ordering only. */
  index: number;
}

/** The one case fold every trigger comparison uses (the mention ranker's precedent). */
export function foldTriggerText(text: string): string {
  return text.toLocaleLowerCase();
}

/**
 * The tool's own phrases that `text` contains, as written — used by the
 * Workbench to warn when an outcome message would echo its own trigger.
 */
export function triggersContainedIn(text: string, triggers: readonly string[] | undefined): string[] {
  if (!text || !triggers?.length) return [];
  const haystack = foldTriggerText(text);
  return triggers.filter((phrase) => phrase.length > 0 && haystack.includes(foldTriggerText(phrase)));
}

/**
 * Strip Carina query lines, fold case, and find every tool whose phrases the text
 * contains. ONE hit per tool — the earliest occurrence of any of its phrases — in
 * order of appearance, capped at MAX_TRIGGER_RUNS_PER_MESSAGE (the rest are
 * returned separately so the caller can log them).
 */
export function scanTriggerPhrases(
  content: string,
  tools: Iterable<Pick<QtapCustomTool, 'name' | 'triggers'>>,
): { hits: TriggerHit[]; dropped: TriggerHit[] } {
  if (!content) return { hits: [], dropped: [] };

  const haystack = foldTriggerText(stripCarinaQueryLines(content));
  if (!haystack.trim()) return { hits: [], dropped: [] };

  const all: TriggerHit[] = [];
  for (const tool of tools) {
    if (!tool.triggers?.length) continue;

    let best: TriggerHit | null = null;
    for (const phrase of tool.triggers) {
      const needle = foldTriggerText(phrase);
      if (!needle) continue;
      const index = haystack.indexOf(needle);
      if (index >= 0 && (best === null || index < best.index)) {
        best = { tool: tool.name, phrase, index };
      }
    }
    if (best) all.push(best);
  }

  // Order of appearance; ties (two tools whose phrases start at the same
  // offset) keep roster order, which `sort` preserves.
  all.sort((a, b) => a.index - b.index);

  return {
    hits: all.slice(0, MAX_TRIGGER_RUNS_PER_MESSAGE),
    dropped: all.slice(MAX_TRIGGER_RUNS_PER_MESSAGE),
  };
}
