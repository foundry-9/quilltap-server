/**
 * The Atlas's prompt section — the particulars of things named in the scene
 * or the recent conversation, told to one character as a trailing per-turn
 * section beside the referent ledger (who is spoken of, then what).
 *
 * `buildAtlasSection` is the **only** prompt-side reader of the Atlas. It
 * reads, never writes, never throws (a failure logs a `warn` and returns
 * `''`), and is empty-is-absent: a turn that names nothing gains nothing and
 * stays byte-identical. Nothing is stored — no Host message, no transcript
 * row, no "already told" state; delivery is derived from history every turn.
 *
 * The scan, in priority order:
 *   1. the recent spoken lines, newest first (the referent ledger's window,
 *      shared through `recentSpokenLines`);
 *   2. the chat's scenario text, only on this seat's first turn under the
 *      current scenario (see {@link isFirstTurnUnderScenario}).
 *
 * Who is told is who can reach the entry: the section is built from the
 * responding character's own pool (`loadAtlasPool`), so a character-vault
 * entry reaches only that character, a group's only its members, and the
 * project's and General's everyone seated. Terms any workspace character
 * answers to are excluded — the referent ledger owns people.
 *
 * Model-facing text is plain and never says "Atlas". Never in system blocks
 * 1–3, and no builder version is bumped.
 *
 * Server-only.
 *
 * @module lib/atlas/prompt-section
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { spokenText } from '@/lib/chat/absent-mentions';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { loadAtlasPool, type PooledAtlasEntry } from '@/lib/atlas/pool';
import { buildAtlasMatcher, findNamedEntries, personTerms } from '@/lib/atlas/match';

/** The most entries one section describes. */
export const ATLAS_SECTION_MAX_ENTRIES = 8;

/** The section's heading. */
export const ATLAS_SECTION_HEADER = '## What is being spoken of';

/** The line beneath the heading. */
export const ATLAS_SECTION_LEAD = 'Particulars of things named in the scene or the recent conversation. This is what you know of them.';

/** The Host rows that set or revise the scenario. */
const SCENARIO_KINDS = new Set(['scenario', 'scenario-change']);

/** Render one entry's block, or null when it has nothing to say. Pure. */
export function renderAtlasEntryBlock(entry: Pick<PooledAtlasEntry, 'name' | 'aliases' | 'graphicPrompt' | 'knowledge'>): string | null {
  const look = entry.graphicPrompt?.trim();
  const knowledge = entry.knowledge?.trim();
  if (!look && !knowledge) return null;
  const head = [`### ${entry.name}`];
  if (entry.aliases && entry.aliases.length > 0) head.push(`Also called: ${entry.aliases.join(', ')}`);
  if (look) head.push(`Appearance: ${look}`);
  return knowledge ? `${head.join('\n')}\n\n${knowledge}` : head.join('\n');
}

/** Render the section from entries in scan order, or `''`. Pure. */
export function renderAtlasSection(entries: ReadonlyArray<Pick<PooledAtlasEntry, 'name' | 'aliases' | 'graphicPrompt' | 'knowledge'>>): string {
  const blocks: string[] = [];
  for (const entry of entries) {
    if (blocks.length >= ATLAS_SECTION_MAX_ENTRIES) break;
    const block = renderAtlasEntryBlock(entry);
    if (block) blocks.push(block);
  }
  if (blocks.length === 0) return '';
  return `${ATLAS_SECTION_HEADER}\n\n${ATLAS_SECTION_LEAD}\n\n${blocks.join('\n\n')}`;
}

/** What the first-turn test reads of a stored event. */
export interface AtlasHistoryEvent {
  id?: string;
  type?: string;
  role?: string;
  content?: string;
  systemSender?: string | null;
  systemKind?: string | null;
  participantId?: string | null;
}

/**
 * True when the responding seat has not yet spoken under the current
 * scenario: no persisted spoken ASSISTANT line of theirs after the latest Host
 * row whose `systemKind` is `scenario` or `scenario-change` (or in the whole
 * chat when there is no such row). Lines in `regenerationOfMessageIds` are
 * ignored, so a swipe of a first line is still a first turn. Without a
 * responding participant, any ASSISTANT line counts. Pure.
 */
export function isFirstTurnUnderScenario(input: {
  events: ReadonlyArray<AtlasHistoryEvent>;
  respondingParticipantId?: string | null;
  regenerationOfMessageIds?: readonly string[] | null;
}): boolean {
  const { events } = input;
  const ignored = new Set(input.regenerationOfMessageIds ?? []);
  let start = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.systemSender === 'host' && e.systemKind && SCENARIO_KINDS.has(e.systemKind)) {
      start = i + 1;
      break;
    }
  }
  for (let i = start; i < events.length; i++) {
    const e = events[i];
    if (e.id && ignored.has(e.id)) continue;
    if ((e.role || '').toUpperCase() !== 'ASSISTANT') continue;
    if (input.respondingParticipantId && e.participantId !== input.respondingParticipantId) continue;
    if (spokenText(e)) return false;
  }
  return true;
}

export interface BuildAtlasSectionInput {
  chat: { id: string; projectId?: string | null; scenarioText?: string | null };
  characterId: string;
  respondingParticipantId?: string | null;
  /** The recent window, oldest first (`recentSpokenLines`). */
  recentLines: Promise<ReadonlyArray<{ content: string }>> | ReadonlyArray<{ content: string }>;
  /** The chat's stored events, oldest first (the shared transcript). */
  loadEvents: () => Promise<ReadonlyArray<AtlasHistoryEvent>>;
  regenerationOfMessageIds?: readonly string[] | null;
  /** The workspace's characters (shared with the referent ledger). */
  workspaceCharacters: Promise<ReadonlyArray<{ name: string; aliases?: readonly string[] | null }>>;
  repos: Pick<RepositoryContainer, 'characters'> & Partial<Pick<RepositoryContainer, 'projects'>>;
}

/** The trailing section for one character's turn, or `''`. Never throws. */
export async function buildAtlasSection(input: BuildAtlasSectionInput): Promise<string> {
  const { chat, characterId } = input;
  try {
    const pool = await loadAtlasPool(input.repos, { characterId, projectId: chat.projectId ?? null });
    if (pool.entries.length === 0) return '';

    const [recent, people] = await Promise.all([input.recentLines, input.workspaceCharacters]);
    const texts = [...recent].reverse().map((line) => line.content);
    let scenarioInScan = false;
    if (chat.scenarioText?.trim()) {
      const events = await input.loadEvents();
      scenarioInScan = isFirstTurnUnderScenario({
        events,
        respondingParticipantId: input.respondingParticipantId,
        regenerationOfMessageIds: input.regenerationOfMessageIds,
      });
      if (scenarioInScan) texts.push(chat.scenarioText);
    }

    const matcher = buildAtlasMatcher(pool.entries, { excludeTerms: personTerms(people) });
    const named = findNamedEntries(texts, matcher);
    const section = renderAtlasSection(named.map((hit) => hit.entry));
    logger.debug('[AtlasSection] Built the things-being-spoken-of section', {
      chatId: chat.id,
      characterId,
      poolEntries: pool.entries.length,
      texts: texts.length,
      terms: matcher?.termCount ?? 0,
      hits: named.length,
      entries: named.slice(0, ATLAS_SECTION_MAX_ENTRIES).map((hit) => hit.entry.name),
      characters: section.length,
      scenarioInScan,
      op: 'prompt-section',
      context: 'atlas',
    });
    return section;
  } catch (error) {
    logger.warn('[AtlasSection] Failed to build the things-being-spoken-of section; turn continues', {
      chatId: chat.id,
      characterId,
      context: 'atlas',
      error: getErrorMessage(error),
    });
    return '';
  }
}
