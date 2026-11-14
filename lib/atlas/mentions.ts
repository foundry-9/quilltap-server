/**
 * Atlas entries named in a chat, for the Salon's chips.
 *
 * For each entry of the chat's cast view, the first message that names it:
 * oldest first, over the spoken lines (`spokenText`) **and the Host's
 * `scenario` / `scenario-change` rows** — the scenario is where a thing usually
 * first appears, and its chip there stands in for a new-chat preview. Terms
 * any workspace character answers to are excluded, as on the model's side
 * (`prompt-section.ts`): a person's chip is a person's.
 *
 * Pure: the caller supplies the messages, the cast view and the people.
 *
 * @module lib/atlas/mentions
 */

import { logger } from '@/lib/logger';
import { spokenText } from '@/lib/chat/absent-mentions';
import { allAtlasMentions, buildAtlasMatcher, personTerms } from '@/lib/atlas/match';
import type { AtlasCard, AtlasMention, AtlasOrigin, AtlasRecord } from '@/lib/schemas/atlas.types';

const SCENARIO_KINDS = new Set(['scenario', 'scenario-change']);

/** What a scan reads of a message. */
export interface AtlasMentionMessage {
  id?: string;
  type?: string;
  role?: string;
  content?: string;
  systemSender?: string | null;
  systemKind?: string | null;
}

/** The text of a message a chip may land in: a spoken line or a Host scenario row. */
export function atlasScanText(m: AtlasMentionMessage): string | null {
  if (m.systemSender === 'host' && m.systemKind && SCENARIO_KINDS.has(m.systemKind)) {
    return m.type !== undefined && m.type !== 'message' ? null : m.content || null;
  }
  return spokenText(m);
}

/** The card a chip's popup shows. Pure. */
export function atlasCardOf(entry: AtlasRecord & { origin: AtlasOrigin }): AtlasCard {
  return {
    entryId: entry.id,
    name: entry.name,
    aliases: [...entry.aliases],
    graphicPrompt: entry.graphicPrompt ?? null,
    knowledge: entry.knowledge ?? null,
    origin: entry.origin,
    imageFileId: entry.imageFileId ?? null,
  };
}

/** The first mention of each entry, in message order. */
export function findAtlasMentions(input: {
  messages: ReadonlyArray<AtlasMentionMessage>;
  entries: ReadonlyArray<AtlasRecord & { origin: AtlasOrigin }>;
  people: ReadonlyArray<{ name?: string | null; aliases?: readonly string[] | null }>;
}): AtlasMention[] {
  const matcher = buildAtlasMatcher(input.entries, { excludeTerms: personTerms(input.people) });
  const found: AtlasMention[] = [];
  if (matcher) {
    const seen = new Set<string>();
    for (const m of input.messages) {
      if (seen.size === input.entries.length) break;
      if (!m.id) continue;
      const text = atlasScanText(m);
      if (!text) continue;
      for (const hit of allAtlasMentions(text, matcher)) {
        if (seen.has(hit.entry.id)) continue;
        seen.add(hit.entry.id);
        found.push({ messageId: m.id, entryId: hit.entry.id, text: hit.text, card: atlasCardOf(hit.entry) });
      }
    }
  }
  logger.debug('[AtlasMentions] Scanned chat for Atlas entries', {
    context: 'atlas',
    messages: input.messages.length,
    entries: input.entries.length,
    terms: matcher?.termCount ?? 0,
    found: found.length,
  });
  return found;
}
