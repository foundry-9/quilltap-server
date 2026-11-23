/**
 * The Atlas as a lorebook — what one character is told of the things in the
 * story, delivered as the `lore` part of the Commonplace Book's whisper beside
 * the character's Knowledge.
 *
 * Two triggers, one list:
 *
 *   - **Named** ({@link buildNamedAtlasLore}): an entry whose name or alias is
 *     said. The scan, in priority order: the recent spoken lines, newest first
 *     (the referent ledger's window, shared through `recentSpokenLines`), then
 *     the chat's scenario text, only on this seat's first turn under the
 *     current scenario ({@link isFirstTurnUnderScenario}). Certain hits: they
 *     take their space in the knowledge budget first, and are built on every
 *     turn, whether or not memory recall runs.
 *   - **Recalled** ({@link AtlasRecallSource}): an entry the conversation bears
 *     on without naming it. The knowledge injector searches `Atlas/` with the
 *     turn's one query and hands each hit here to be resolved against the
 *     character's pool; what resolves competes with Knowledge by score for the
 *     budget the named entries left. An entry already named is never repeated.
 *
 * This module is the **only** prompt-side reader of the Atlas. It reads, never
 * writes, never throws (a failure logs a `warn` and returns nothing), and is
 * empty-is-absent. Nothing is stored beyond the whisper the Commonplace Book
 * posts: no "already told" state; delivery is derived every turn.
 *
 * Who is told is who can reach the entry: both triggers read the responding
 * character's own pool (`loadAtlasPool`), so a character-vault entry reaches
 * only that character, a group's only its members, and the project's and
 * General's everyone seated; a shadowed or archived entry is never recalled.
 * Terms any workspace character answers to are excluded from the named scan —
 * the referent ledger owns people.
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
import { ATLAS_FOLDER, joinFolder } from '@/lib/atlas/folders';
import { atlasKnowledgeOfBody } from '@/lib/atlas/vault-readers';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { estimateTokens } from '@/lib/tokens/token-counter';
import type { Provider } from '@/lib/schemas/types';

/** The most named entries one turn describes. */
export const ATLAS_LORE_MAX_NAMED = 8;

/** The least room worth cutting a named entry down to; with less left, it is left out. */
export const ATLAS_LORE_MIN_CUT_TOKENS = 120;

/** What marks knowledge cut short to fit. */
export const ATLAS_LORE_CUT_MARK = ' …';

type RenderableEntry = Pick<PooledAtlasEntry, 'name' | 'aliases' | 'graphicPrompt' | 'knowledge'>;

/** The Host rows that set or revise the scenario. */
const SCENARIO_KINDS = new Set(['scenario', 'scenario-change']);

/** Render one entry's block, or null when it has nothing to say. Pure. */
export function renderAtlasEntryBlock(entry: RenderableEntry): string | null {
  const look = entry.graphicPrompt?.trim();
  const knowledge = entry.knowledge?.trim();
  if (!look && !knowledge) return null;
  const head = [`### ${entry.name}`];
  if (entry.aliases && entry.aliases.length > 0) head.push(`Also called: ${entry.aliases.join(', ')}`);
  if (look) head.push(`Appearance: ${look}`);
  return knowledge ? `${head.join('\n')}\n\n${knowledge}` : head.join('\n');
}

/** Join lore blocks (named first, then recalled) into the one `lore` part; `''` when none. Pure. */
export function joinAtlasLore(...parts: ReadonlyArray<string | null | undefined>): string {
  return parts.map((part) => part?.trim()).filter((part): part is string => !!part).join('\n\n');
}

/**
 * An entry's block cut to fit `maxTokens`: its head (name, aliases,
 * appearance) whole and its knowledge cut at a word boundary, marked with
 * {@link ATLAS_LORE_CUT_MARK}. Null when even the head does not fit. Pure.
 */
export function cutAtlasEntryBlock(
  entry: RenderableEntry,
  maxTokens: number,
  count: (text: string) => number,
): string | null {
  const knowledge = entry.knowledge?.trim();
  const head = renderAtlasEntryBlock({ ...entry, knowledge: null });
  if (!knowledge) return head && count(head) <= maxTokens ? head : null;
  const room = maxTokens - (head ? count(head) : count(`### ${entry.name}`));
  if (room <= 0) return null;
  let chars = Math.floor(knowledge.length * Math.min(1, room / Math.max(1, count(knowledge))));
  for (let attempt = 0; attempt < 6 && chars > 0; attempt++) {
    const slice = knowledge.slice(0, chars);
    const lastSpace = slice.search(/\s\S*$/);
    const cut = (lastSpace > chars / 2 ? slice.slice(0, lastSpace) : slice).trimEnd();
    const block = renderAtlasEntryBlock({ ...entry, knowledge: `${cut}${ATLAS_LORE_CUT_MARK}` });
    if (block && count(block) <= maxTokens) return block;
    chars = Math.floor(chars * 0.85);
  }
  return null;
}

/** One entry's place in a turn's lore, for the debug record. */
export interface AtlasLoreDebugEntry {
  name: string;
  tokens: number;
  /** True when the knowledge was cut to fit. */
  cut: boolean;
}

/** Pack named entries (scan order) into `budgetTokens`. Pure. */
export function packNamedAtlasEntries(
  entries: ReadonlyArray<RenderableEntry>,
  budgetTokens: number,
  count: (text: string) => number,
): { content: string; tokens: number; told: AtlasLoreDebugEntry[]; leftOut: string[] } {
  const blocks: string[] = [];
  const told: AtlasLoreDebugEntry[] = [];
  const leftOut: string[] = [];
  let tokens = 0;
  for (const entry of entries) {
    const whole = renderAtlasEntryBlock(entry);
    if (!whole) continue;
    if (blocks.length >= ATLAS_LORE_MAX_NAMED) {
      leftOut.push(entry.name);
      continue;
    }
    const left = budgetTokens - tokens;
    let block: string | null = whole;
    let cut = false;
    if (count(whole) > left) {
      block = left >= ATLAS_LORE_MIN_CUT_TOKENS ? cutAtlasEntryBlock(entry, left, count) : null;
      cut = true;
    }
    if (!block) {
      leftOut.push(entry.name);
      continue;
    }
    const blockTokens = count(block);
    blocks.push(block);
    tokens += blockTokens;
    told.push({ name: entry.name, tokens: blockTokens, cut });
  }
  return { content: blocks.join('\n\n'), tokens, told, leftOut };
}

/** A recalled entry, rendered both ways; the packer picks what fits. */
export interface AtlasRecallBlock {
  entryId: string;
  name: string;
  /** The whole entry. */
  full: string;
  /** The entry's head with only the passage that matched; null when the passage holds no knowledge. */
  excerpt: string | null;
}

/**
 * Resolves a search hit under `Atlas/` to an entry of the character's pool.
 * Null for a file that is not a reachable live entry (shadowed, archived, a
 * note, a picture), for one with nothing to say, and for one already named
 * this turn.
 */
export interface AtlasRecallSource {
  resolve(hit: { mountPointId: string; relativePath: string; content: string }): AtlasRecallBlock | null;
}

/**
 * The least similarity at which an entry is recalled without being named.
 * Higher than Knowledge's floor (0.3): an entry is short and is given whole,
 * so a loose match costs more than a pointer to a file does, and a named
 * entry needs no help from here. A caller's own floor wins when it is higher.
 */
export const ATLAS_RECALL_MIN_SCORE = 0.4;

/** The path prefix the relevant search is scoped to. */
export const ATLAS_RECALL_PATH_PREFIX = `${ATLAS_FOLDER}/`;

const pathKey = (mountPointId: string, relativePath: string) => `${mountPointId}::${relativePath.toLowerCase()}`;

/** The knowledge in an indexed passage: frontmatter (when the passage opens the file) stripped. */
function passageKnowledge(content: string): string | null {
  const text = (content ?? '').replace(/\r\n/g, '\n');
  try {
    const parsed = parseFrontmatter(text);
    return atlasKnowledgeOfBody(parsed.data ? text.slice(parsed.bodyStartOffset) : text);
  } catch {
    return atlasKnowledgeOfBody(text);
  }
}

/** The recall source over a pool, skipping the entries in `toldIds`. Pure. */
export function atlasRecallSourceFor(
  entries: ReadonlyArray<PooledAtlasEntry>,
  toldIds: ReadonlySet<string>,
): AtlasRecallSource {
  const byPath = new Map<string, PooledAtlasEntry>();
  for (const entry of entries) {
    if (!entry.fileStem) continue;
    byPath.set(pathKey(entry.mountPointId, joinFolder(ATLAS_FOLDER, entry.folder ?? '', `${entry.fileStem}.md`)), entry);
  }
  return {
    resolve(hit) {
      const entry = byPath.get(pathKey(hit.mountPointId, hit.relativePath));
      if (!entry || toldIds.has(entry.id)) return null;
      const full = renderAtlasEntryBlock(entry);
      if (!full) return null;
      const passage = passageKnowledge(hit.content);
      return {
        entryId: entry.id,
        name: entry.name,
        full,
        excerpt: passage ? renderAtlasEntryBlock({ ...entry, knowledge: passage }) : null,
      };
    },
  };
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

export interface BuildNamedAtlasLoreInput {
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
  /** What the named entries may spend: the turn's knowledge budget. */
  budgetTokens: number;
  provider: Provider;
  repos: Pick<RepositoryContainer, 'characters'> & Partial<Pick<RepositoryContainer, 'projects'>>;
}

/** The named half of a turn's lore, and the door for the recalled half. */
export interface NamedAtlasLore {
  /** The named entries' blocks; `''` when nothing is named. */
  content: string;
  tokens: number;
  told: AtlasLoreDebugEntry[];
  /** For the relevant search; null when the character reaches no entry. */
  recall: AtlasRecallSource | null;
}

const NO_LORE: NamedAtlasLore = { content: '', tokens: 0, told: [], recall: null };

/** The named entries for one character's turn. Never throws. */
export async function buildNamedAtlasLore(input: BuildNamedAtlasLoreInput): Promise<NamedAtlasLore> {
  const { chat, characterId } = input;
  try {
    const pool = await loadAtlasPool(input.repos, { characterId, projectId: chat.projectId ?? null });
    if (pool.entries.length === 0) return NO_LORE;

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
    const packed = packNamedAtlasEntries(
      named.map((hit) => hit.entry),
      Math.max(0, input.budgetTokens),
      (text) => estimateTokens(text, input.provider),
    );
    logger.debug('[AtlasLore] Packed the named entries', {
      chatId: chat.id,
      characterId,
      poolEntries: pool.entries.length,
      texts: texts.length,
      terms: matcher?.termCount ?? 0,
      hits: named.length,
      told: packed.told,
      leftOut: packed.leftOut,
      tokens: packed.tokens,
      budgetTokens: input.budgetTokens,
      scenarioInScan,
      op: 'named-lore',
      context: 'atlas',
    });
    return {
      content: packed.content,
      tokens: packed.tokens,
      told: packed.told,
      // Every named entry is spoken for, told or not: one left out for room
      // must not come back through the relevant search.
      recall: atlasRecallSourceFor(pool.entries, new Set(named.map((hit) => hit.entry.id))),
    };
  } catch (error) {
    logger.warn('[AtlasLore] Failed to build the named entries; turn continues', {
      chatId: chat.id,
      characterId,
      context: 'atlas',
      error: getErrorMessage(error),
    });
    return NO_LORE;
  }
}
