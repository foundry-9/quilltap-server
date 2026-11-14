/**
 * Brahma Lookup Tool Handlers (Brahma Console — operator shortcuts)
 *
 * The four read-only shortcuts the Brahma Console reaches for before it falls
 * back to hand-written SQL:
 *
 *   - `lookup_character` — a character's core fields, memory count and
 *     conversations in one call.
 *   - `lookup_memories`  — a relevance search over one character's (or every
 *     character's) Commonplace Book, as inspection: nothing is stamped as
 *     recalled (no access stamp is written), so a lookup never changes what a character
 *     will remember next.
 *   - `lookup_messages`  — the FTS5 message index (`searchMessagesGlobal`, the
 *     same path as the global search bar), with conversation titles, dates and
 *     speaker names attached.
 *   - `read_messages`    — a bounded, speaker-labelled slice of one
 *     conversation.
 *
 * Every one of them answers in the operator's terms (names, titles, dates)
 * rather than raw rows, and every text field is truncated, so a single call can
 * never flood the console's context the way an unbounded `run_sql` dump did.
 *
 * Errors are returned as data (`{ success: false, error }`), never thrown, so
 * the model can read the message and adjust.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getRepositories } from '@/lib/repositories/factory'
import type { Character, ChatMetadata, MessageEvent } from '@/lib/schemas/types'
import { isCharacterAuthoredMessage } from '@/lib/chat/chat-activity'
import { resolveSpeakerNames, speakerLabel } from '@/lib/chat/speaker-names'
import { searchMemories } from '@/lib/memory/recall/search'
import type { RecallCandidate } from '@/lib/memory/recall/types'
import { filterImportance } from '@/lib/memory/scoring'
import { zonedDayBoundsIso } from '@/lib/memory/time/calendar'
import { refreshMemoryTimeZone } from '@/lib/memory/time/calendar-refresh'
import type { EmbeddingResult } from '@/lib/embedding/embedding-service'
import { memoryArchivedLabel } from './search-scriptorium-handler'
import { lookupCharacterToolInputSchema } from '../lookup-character-tool'
import { lookupMemoriesToolInputSchema } from '../lookup-memories-tool'
import { lookupMessagesToolInputSchema } from '../lookup-messages-tool'
import { readMessagesToolInputSchema } from '../read-messages-tool'
import { composePublicIdentity } from '@/lib/characters/public-identity'

const logger = createServiceLogger('BrahmaLookup')

/** The databases are per-instance; `userId` is carried for attribution only. */
export interface BrahmaLookupToolContext {
  userId: string
}

export type BrahmaLookupResult =
  | ({ success: true } & Record<string, unknown>)
  | { success: false; error: string }

/** Conversation types an operator means by "conversations". */
const CONVERSATION_CHAT_TYPES = new Set(['salon', 'autonomous'])

/** Text budgets, in characters. */
const CORE_FIELD_CHARS = 3000
const PHYSICAL_CHARS = 1500
const MEMORY_CHARS = 700
const MESSAGE_CHARS = 2500
const SNIPPET_CHARS = 320
const RECENT_CONVERSATIONS = 8
/** How many holders a "search everyone" memory query may visit. */
const MAX_HOLDERS = 60
/** Over-fetch for message searches that are post-filtered by speaker or date. */
const MESSAGE_OVERFETCH = 200

// ============================================================================
// Shared helpers
// ============================================================================

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  return trimmed.length > max ? `${trimmed.slice(0, max)}… [truncated, ${trimmed.length} chars in all]` : trimmed
}

function invalid(tool: string, issues: { path: PropertyKey[]; message: string }[]): BrahmaLookupResult {
  const issue = issues[0]
  return {
    success: false,
    error: `Invalid ${tool} input: ${issue ? `${issue.path.join('.')} — ${issue.message}` : 'malformed arguments'}.`,
  }
}

type CharacterMatch =
  | { kind: 'found'; character: Character }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: Array<{ id: string; name: string }> }

/**
 * Resolve a name, alias or id to one character. Exact id / name matches come
 * from the unhydrated rows (`findAllRaw` — aliases are not needed to match a
 * name, and hydrating every vault to resolve one would be wasted work); only
 * when that misses are the hydrated rows (`findAll`) consulted for aliases and
 * partial names. The winner is always returned hydrated via `findById`.
 */
async function resolveCharacterRef(ref: string): Promise<CharacterMatch> {
  const repos = getRepositories()
  const needle = ref.trim().toLowerCase()
  if (!needle) return { kind: 'none' }

  const hydrate = async (id: string): Promise<CharacterMatch> => {
    const character = await repos.characters.findById(id)
    return character ? { kind: 'found', character } : { kind: 'none' }
  }

  const raw = await repos.characters.findAllRaw()
  const byId = raw.find(c => c.id.toLowerCase() === needle)
  if (byId) return hydrate(byId.id)
  const byName = raw.filter(c => c.name.trim().toLowerCase() === needle)
  if (byName.length === 1) return hydrate(byName[0].id)

  // Aliases live in the vault, so the alias match needs hydrated characters
  // (a raw row has none — it used to be matched against nothing here).
  const all = byName.length > 1
    ? await repos.characters.findByIds(byName.map(c => c.id))
    : await repos.characters.findAll()
  const exact = all.filter(c =>
    c.name.trim().toLowerCase() === needle ||
    (c.aliases ?? []).some(a => a.trim().toLowerCase() === needle)
  )
  const pool = exact.length > 0
    ? exact
    : all.filter(c =>
        c.name.toLowerCase().includes(needle) ||
        (c.aliases ?? []).some(a => a.toLowerCase().includes(needle))
      )
  // Prefer a live character over an archived namesake.
  const live = pool.filter(c => !c.archivedAt)
  const chosen = live.length > 0 ? live : pool
  if (chosen.length === 1) return hydrate(chosen[0].id)
  if (chosen.length === 0) return { kind: 'none' }
  return { kind: 'ambiguous', candidates: chosen.slice(0, 10).map(c => ({ id: c.id, name: c.name })) }
}

/** A resolution failure, phrased for the model. */
function unresolved(ref: string, match: CharacterMatch): BrahmaLookupResult {
  if (match.kind === 'ambiguous') {
    return {
      success: false,
      error: `"${ref}" matches more than one character; pass one of these ids instead: ${match.candidates
        .map(c => `${c.name} (${c.id})`)
        .join(', ')}.`,
    }
  }
  return { success: false, error: `No character matches "${ref}". Try another spelling, an alias, or lookup_character.` }
}

/**
 * Date-only bounds widen to whole LOCAL days on the memory calendar (bug 212),
 * matching the `search` tool; a full timestamp passes through.
 */
async function resolveWindow(since?: string, until?: string): Promise<{ from: string; to: string } | null> {
  if (!since && !until) return null
  const tz = await refreshMemoryTimeZone()
  const from = since
    ? (since.length === 10 ? zonedDayBoundsIso(since, tz)?.from ?? `${since}T00:00:00.000Z` : since)
    : '0000-01-01T00:00:00.000Z'
  const to = until
    ? (until.length === 10 ? zonedDayBoundsIso(until, tz)?.to ?? `${until}T23:59:59.999Z` : until)
    : '9999-12-31T23:59:59.999Z'
  return { from, to }
}

/** Load chats by id once each, for titles and dates. */
async function loadChats(ids: Iterable<string>): Promise<Map<string, ChatMetadata>> {
  const repos = getRepositories()
  const out = new Map<string, ChatMetadata>()
  for (const id of new Set(ids)) {
    try {
      const chat = await repos.chats.findById(id)
      if (chat) out.set(id, chat)
    } catch (error) {
      logger.debug('Chat lookup failed while labelling results', {
        chatId: id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return out
}

function conversationRef(chat: ChatMetadata | undefined, id: string | null | undefined) {
  if (!id) return null
  return chat
    ? { id, title: chat.title || 'Untitled', createdAt: chat.createdAt, chatType: chat.chatType }
    : { id, title: null, note: 'conversation no longer exists' }
}

/** A window of `text` around the first query word it contains. */
function snippetAround(text: string, query: string): string {
  const words = query
    .replace(/["*()]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 1 && !['and', 'or', 'not', 'near'].includes(w))
  const lower = text.toLowerCase()
  let at = -1
  for (const w of words) {
    const i = lower.indexOf(w)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return clip(text, SNIPPET_CHARS) ?? ''
  const start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 3))
  const end = Math.min(text.length, start + SNIPPET_CHARS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

// ============================================================================
// lookup_character
// ============================================================================

export async function executeLookupCharacterTool(
  input: unknown,
  context: BrahmaLookupToolContext
): Promise<BrahmaLookupResult> {
  const parsed = lookupCharacterToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('lookup_character', parsed.error.issues)

  try {
    const match = await resolveCharacterRef(parsed.data.character)
    if (match.kind !== 'found') return unresolved(parsed.data.character, match)
    const c = match.character
    const repos = getRepositories()

    const memoryCount = await repos.memories.countByCharacterId(c.id)
    const chats = (await repos.chats.findByCharacterId(c.id))
      .filter(chat => CONVERSATION_CHAT_TYPES.has(chat.chatType ?? 'salon'))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    const firstChat = chats.length > 0
      ? chats.reduce((a, b) => ((a.createdAt ?? '') <= (b.createdAt ?? '') ? a : b))
      : null

    const pd = c.physicalDescription
    logger.debug('lookup_character resolved', {
      userId: context.userId,
      characterId: c.id,
      memoryCount,
      conversationCount: chats.length,
    })

    return {
      success: true,
      id: c.id,
      name: c.name,
      aliases: c.aliases ?? [],
      pronouns: c.pronouns ?? null,
      title: c.title ?? null,
      controlledBy: c.controlledBy,
      archived: !!c.archivedAt,
      createdAt: c.createdAt,
      // The public identity: age, public progressions and pronouns, then identity.md.
      identity: clip(composePublicIdentity(c, c.identity), CORE_FIELD_CHARS),
      birthday: c.birthday ?? null,
      description: clip(c.description, CORE_FIELD_CHARS),
      personality: clip(c.personality, CORE_FIELD_CHARS),
      manifesto: clip(c.manifesto, CORE_FIELD_CHARS),
      physicalDescription: pd
        ? clip(pd.fullDescription ?? pd.completePrompt ?? pd.longPrompt ?? pd.mediumPrompt ?? pd.shortPrompt, PHYSICAL_CHARS)
        : null,
      vaultMountPointId: c.characterDocumentMountPointId ?? null,
      memoriesHeld: memoryCount,
      conversations: {
        count: chats.length,
        first: firstChat ? conversationRef(firstChat, firstChat.id) : null,
        mostRecent: chats.slice(0, RECENT_CONVERSATIONS).map(chat => ({
          ...conversationRef(chat, chat.id),
          updatedAt: chat.updatedAt,
        })),
      },
      hint: 'For facts not in these fields (an age when there is no birthday, a date, an event), use lookup_memories with character set to this one, then lookup_messages.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('lookup_character failed', { userId: context.userId, error: message })
    return { success: false, error: `lookup_character failed: ${message}` }
  }
}

// ============================================================================
// lookup_memories
// ============================================================================

export async function executeLookupMemoriesTool(
  input: unknown,
  context: BrahmaLookupToolContext
): Promise<BrahmaLookupResult> {
  const parsed = lookupMemoriesToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('lookup_memories', parsed.error.issues)
  const { query, character, about, since, until } = parsed.data
  const limit = parsed.data.limit ?? 10

  try {
    const repos = getRepositories()

    // Holders: one named character, or every live character holding memories.
    let holders: Array<{ id: string; name: string }>
    if (character) {
      const match = await resolveCharacterRef(character)
      if (match.kind !== 'found') return unresolved(character, match)
      holders = [{ id: match.character.id, name: match.character.name }]
    } else {
      const raw = (await repos.characters.findAllRaw()).filter(c => !c.archivedAt)
      holders = []
      for (const c of raw) {
        if (holders.length >= MAX_HOLDERS) break
        if ((await repos.memories.countByCharacterId(c.id)) > 0) holders.push({ id: c.id, name: c.name })
      }
    }

    let aboutCharacterId: string | undefined
    if (about) {
      const match = await resolveCharacterRef(about)
      if (match.kind !== 'found') return unresolved(about, match)
      aboutCharacterId = match.character.id
    }

    const window = await resolveWindow(since, until)
    // One embedding for the whole sweep, however many holders it visits.
    const embeddingMemo = new Map<string, EmbeddingResult>()
    const hits: Array<RecallCandidate & { holderName: string }> = []
    for (const holder of holders) {
      const found = await searchMemories(holder.id, query, {
        userId: context.userId,
        limit,
        literalPhrase: true,
        aboutCharacterId,
        window,
        includeCold: true,
        embeddingMemo,
      })
      for (const f of found) hits.push({ ...f, holderName: holder.name })
    }
    hits.sort((a, b) => b.score - a.score)
    const top = hits.slice(0, limit)

    // Names for the about-subjects, titles for the source conversations.
    const nameById = new Map<string, string>()
    for (const c of await repos.characters.findAllRaw()) nameById.set(c.id, c.name)
    const chats = await loadChats(top.map(h => h.memory.chatId).filter((id): id is string => !!id))

    logger.debug('lookup_memories completed', {
      userId: context.userId,
      holders: holders.length,
      aboutCharacterId,
      windowed: !!window,
      hits: hits.length,
      returned: top.length,
    })

    return {
      success: true,
      query,
      searched: character ? holders[0].name : `${holders.length} characters`,
      count: top.length,
      memories: top.map(h => ({
        memoryId: h.memory.id,
        heldBy: h.holderName,
        about: h.memory.aboutCharacterId ? nameById.get(h.memory.aboutCharacterId) ?? h.memory.aboutCharacterId : null,
        content: clip(h.memory.content, MEMORY_CHARS),
        happenedAt: h.memory.occurredAt ?? null,
        narrativeTime: h.memory.narrativeTime ?? null,
        recordedAt: h.memory.createdAt,
        importance: Math.round(filterImportance(h.memory) * 100) / 100,
        relevance: Math.round(h.score * 1000) / 1000,
        source: h.memory.source,
        archived: memoryArchivedLabel(h.memory) ?? null,
        conversation: conversationRef(h.memory.chatId ? chats.get(h.memory.chatId) : undefined, h.memory.chatId),
      })),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('lookup_memories failed', { userId: context.userId, error: message })
    return { success: false, error: `lookup_memories failed: ${message}` }
  }
}

// ============================================================================
// lookup_messages
// ============================================================================

export async function executeLookupMessagesTool(
  input: unknown,
  context: BrahmaLookupToolContext
): Promise<BrahmaLookupResult> {
  const parsed = lookupMessagesToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('lookup_messages', parsed.error.issues)
  const { query, character, speaker, since, until } = parsed.data
  const limit = parsed.data.limit ?? 10

  try {
    const repos = getRepositories()

    let chats: ChatMetadata[]
    if (character) {
      const match = await resolveCharacterRef(character)
      if (match.kind !== 'found') return unresolved(character, match)
      chats = await repos.chats.findByCharacterId(match.character.id)
    } else {
      chats = await repos.chats.findAll()
    }
    chats = chats.filter(chat => CONVERSATION_CHAT_TYPES.has(chat.chatType ?? 'salon'))

    let speakerCharacterId: string | undefined
    if (speaker) {
      const match = await resolveCharacterRef(speaker)
      if (match.kind !== 'found') return unresolved(speaker, match)
      speakerCharacterId = match.character.id
      chats = chats.filter(chat => chat.participants.some(p => p.characterId === speakerCharacterId))
    }

    if (chats.length === 0) {
      return { success: true, query, count: 0, hits: [], note: 'No conversations match those filters.' }
    }

    const chatById = new Map(chats.map(chat => [chat.id, chat]))
    const postFiltered = !!(speakerCharacterId || since || until)
    const raw = await repos.chats.searchMessagesGlobal(
      chats.map(chat => chat.id),
      query,
      postFiltered ? MESSAGE_OVERFETCH : limit
    )

    const window = await resolveWindow(since, until)

    const kept = raw.filter(hit => {
      if (window && (hit.createdAt < window.from || hit.createdAt > window.to)) return false
      if (speakerCharacterId) {
        const seat = chatById.get(hit.chatId)?.participants.find(p => p.id === hit.participantId)
        if (seat?.characterId !== speakerCharacterId) return false
      }
      return true
    }).slice(0, limit)

    const namesByChat = new Map<string, Awaited<ReturnType<typeof resolveSpeakerNames>>>()
    const hits = []
    for (const hit of kept) {
      const chat = chatById.get(hit.chatId)
      let names = namesByChat.get(hit.chatId)
      if (!names && chat) {
        names = await resolveSpeakerNames(chat)
        namesByChat.set(hit.chatId, names)
      }
      hits.push({
        conversation: conversationRef(chat, hit.chatId),
        messageId: hit.messageId,
        writtenAt: hit.createdAt,
        speaker: speakerLabel(
          { participantId: hit.participantId ?? undefined, role: hit.role as MessageEvent['role'] },
          names ?? new Map()
        ),
        snippet: snippetAround(hit.content, query),
      })
    }

    logger.debug('lookup_messages completed', {
      userId: context.userId,
      chatCount: chats.length,
      rawHits: raw.length,
      returned: hits.length,
      postFiltered,
    })

    return {
      success: true,
      query,
      count: hits.length,
      hits,
      ...(hits.length === 0
        ? { note: 'No matches. Try fewer or different words, a word stem (e.g. "birth" finds "birthday"), or drop a filter.' }
        : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('lookup_messages failed', { userId: context.userId, error: message })
    return { success: false, error: `lookup_messages failed: ${message}` }
  }
}

// ============================================================================
// read_messages
// ============================================================================

export async function executeReadMessagesTool(
  input: unknown,
  context: BrahmaLookupToolContext
): Promise<BrahmaLookupResult> {
  const parsed = readMessagesToolInputSchema.safeParse(input)
  if (!parsed.success) return invalid('read_messages', parsed.error.issues)
  const { conversation_id, around_message_id } = parsed.data

  try {
    const repos = getRepositories()
    const chat = await repos.chats.findById(conversation_id)
    if (!chat) return { success: false, error: `No conversation with id ${conversation_id}.` }

    const lines = (await repos.chats.getMessages(conversation_id)).filter(isCharacterAuthoredMessage)
    let start: number
    let end: number
    if (around_message_id) {
      const at = lines.findIndex(m => m.id === around_message_id)
      if (at < 0) {
        return {
          success: false,
          error: `Message ${around_message_id} is not a spoken line of this conversation (it may be a system notice, or belong to another conversation).`,
        }
      }
      start = Math.max(0, at - (parsed.data.before ?? 3))
      end = Math.min(lines.length, at + (parsed.data.after ?? 3) + 1)
    } else {
      const offset = parsed.data.offset ?? 0
      const count = parsed.data.count ?? 10
      start = offset < 0 ? Math.max(0, lines.length + offset) : Math.min(offset, lines.length)
      end = Math.min(lines.length, start + count)
    }

    const names = await resolveSpeakerNames(chat)
    const cast = Array.from(new Set(names.values()))

    logger.debug('read_messages completed', {
      userId: context.userId,
      chatId: conversation_id,
      totalLines: lines.length,
      start,
      end,
    })

    return {
      success: true,
      conversation: {
        ...conversationRef(chat, chat.id),
        updatedAt: chat.updatedAt,
        cast,
        spokenLines: lines.length,
      },
      range: { from: start, to: end - 1 },
      messages: lines.slice(start, end).map((m, i) => ({
        index: start + i,
        messageId: m.id,
        speaker: speakerLabel(m, names),
        writtenAt: m.createdAt,
        content: clip(m.content, MESSAGE_CHARS) ?? '',
      })),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('read_messages failed', { userId: context.userId, error: message })
    return { success: false, error: `read_messages failed: ${message}` }
  }
}
