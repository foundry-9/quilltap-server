/**
 * Composer slash commands — ranking (pure logic).
 *
 * Tiers, best first: the command word exactly; the command word as a prefix; a
 * word of the command, label or a keyword as a prefix (`_` and `-` split words,
 * so `/wear` finds `wardrobe_wear`). Mid-word substrings are deliberately not
 * matched — the mention typeahead's precedent. Within a tier the composer's own
 * actions come first, then the operator's custom tools, then the house's
 * built-ins; then the label.
 *
 * @module lib/slash-commands/ranking
 */

import type { SlashCommand, SlashCommandKind } from './types';

const MatchTier = { Exact: 0, CommandPrefix: 1, WordPrefix: 2 } as const;
type MatchTier = (typeof MatchTier)[keyof typeof MatchTier];

const KIND_ORDER: Record<SlashCommandKind, number> = {
  action: 0,
  'custom-tool': 1,
  'builtin-tool': 2,
};

const WORD_SPLIT = /[\s\-_'’.·]+/u;

function fold(text: string): string {
  return text.toLocaleLowerCase();
}

function words(text: string): string[] {
  return fold(text).split(WORD_SPLIT).filter(Boolean);
}

function matchTier(command: SlashCommand, needle: string): MatchTier | null {
  const word = fold(command.command);
  if (word === needle) return MatchTier.Exact;
  if (word.startsWith(needle)) return MatchTier.CommandPrefix;
  const terms = [command.command, command.label, ...command.keywords];
  if (terms.some((term) => words(term).some((w) => w.startsWith(needle)))) return MatchTier.WordPrefix;
  return null;
}

function byKindThenLabel(a: SlashCommand, b: SlashCommand): number {
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) ||
    a.key.localeCompare(b.key)
  );
}

/**
 * Filter and order commands for a query.
 *
 * An empty query (a bare `/`) returns every command — actions, then custom
 * tools, then built-ins, each group by label — and `limit` does not apply: the
 * menu scrolls, and a bare slash is a request to browse. A non-empty query
 * returns at most `limit` matches.
 */
export function rankSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
  limit = 12,
): SlashCommand[] {
  const needle = fold(query);
  if (needle.length === 0) return [...commands].sort(byKindThenLabel);

  const scored: Array<{ command: SlashCommand; tier: MatchTier }> = [];
  for (const command of commands) {
    const tier = matchTier(command, needle);
    if (tier !== null) scored.push({ command, tier });
  }

  scored.sort((a, b) => a.tier - b.tier || byKindThenLabel(a.command, b.command));
  return scored.slice(0, limit).map((entry) => entry.command);
}
