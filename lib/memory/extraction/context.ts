/**
 * The extraction context (memory refactor §3.7): everything a unit of work's
 * passes share, built once.
 *
 * A unit of work is one closed turn, one Carina answer, one fold, one catch-up
 * job or one dry run. Each calls {@link buildExtractionContext} once and hands
 * the context to every pass it runs, so the chat, its cast, the project, the
 * cheap-LLM route, the memory calendar, the settings and the rate limiter are
 * read once — where the per-turn handler, the fold passes, the catch-ups and
 * the dry run used to rebuild each for themselves (and Carina missed the
 * project, the episode pass the uncensored fallback; bugs 213, 222).
 *
 * @module memory/extraction/context
 */

import { getRepositories } from '@/lib/repositories/factory'
import { resolveSpeakerNames, type SpeakerNames } from '@/lib/chat/speaker-names'
import { isParticipantPresent } from '@/lib/schemas/types'
import type { Character, ChatMetadata, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { Pronouns } from '@/lib/schemas/character.types'
import { logger } from '@/lib/logger'
import { resolveMemorySettings, type MemorySettings } from '../settings'
import { refreshMemoryTimeZone } from '../time/calendar-refresh'
import type { MemoryClock } from '../time/clock'
import {
  loadCanonForObserverAboutSubject,
  loadCanonForSelfWithCommonplace,
  renderOtherCanonBlock,
  renderSelfCanonBlock,
} from '../cheap-llm-tasks/canon'
import type { ExtractionClock, OrientingContext } from './prompts/shared'
import { resolveExtractionRoute, type ExtractionRoute } from './route'
import { createRateLimiter, type RateLimiter } from './rate-limit'
import { liveCursorStore, memoryCursorStore, type CursorStore } from './cursors'

/** One character the unit of work may extract for or about. */
export interface CastMember {
  characterId: string
  /** The seat in this chat, or null for a character outside it (a Carina answerer). */
  participantId: string | null
  name: string
  pronouns: Pronouns | null
  /** Played by the human (`controlledBy: 'user'`). */
  isUser: boolean
  /** Seated and present (`isParticipantPresent`); false for an answerer outside the chat. */
  present: boolean
  character: Character
}

export interface ExtractionContext {
  chat: ChatMetadata
  userId: string
  /** The memory calendar, read once; windows set their own instant ({@link clockAt}). */
  clock: MemoryClock & { timelineMode: 'realtime' | 'narrative' }
  settings: MemorySettings['extraction']
  /** characterId → member: every CHARACTER seat (the user's included), plus any extra character asked for. */
  cast: ReadonlyMap<string, CastMember>
  /** The user-controlled character, when one is seated. */
  userCharacter: CastMember | null
  speakerNames: SpeakerNames
  /** The holder's own ALREADY ESTABLISHED block (card fields + `Commonplace/Self.md`). Memoised. */
  canonForSelf(holderId: string): Promise<string>
  /** What `holderId` already knows about `aboutId` (`Others/<name>.md`, identity, digest). Memoised. */
  canonFor(holderId: string, aboutId: string): Promise<{ block: string; source: string }>
  project: { id: string | null; description: string | null }
  /** Background for the prompt footer, never a memory source. */
  orienting: OrientingContext
  route: ExtractionRoute
  rateLimit: RateLimiter
  cursors: CursorStore
  dryRun: boolean
  /** A rebuild of history; see {@link BuildExtractionContextOptions.backfill}. */
  backfill: boolean
  inAutonomousRoom: boolean
  /** The chat's `type: 'message'` rows, chronological. Read once, on first use. */
  messages(): Promise<MessageEvent[]>
}

export interface BuildExtractionContextOptions {
  dryRun?: boolean
  /** The profile the unit of work runs against (budget, cost, cheap-LLM base). */
  connectionProfile?: ConnectionProfile
  connectionProfileId?: string | null
  /** The chat row, when the caller already holds it. */
  chat?: ChatMetadata
  /** The chat's message rows, when the caller already holds them. */
  messages?: MessageEvent[]
  /** Overrides `chat.contextSummary` as background (a fold passes the summary it just wrote). */
  chatContextSummary?: string | null
  /** Characters outside the chat's seats to hydrate (a Carina answerer). */
  extraCharacterIds?: string[]
  /** Defaults to the chat's live cursors, or an empty in-memory store for a dry run. */
  cursors?: CursorStore
  /**
   * A rebuild of history (regenerate, queue-memories, import, the dry run that
   * previews a regenerate): the rate limit is off, and admissions do not count
   * towards it.
   */
  backfill?: boolean
}

export class ExtractionContextError extends Error {
  constructor(public readonly reason: 'no-chat' | 'no-connection-profile', message: string) {
    super(message)
    this.name = 'ExtractionContextError'
  }
}

/** The connection profile a unit of work runs on when none is named: an LLM seat's, else any seat's. */
export function pickExtractionConnectionProfileId(chat: Pick<ChatMetadata, 'participants'>): string | null {
  const llmSeat = chat.participants.find(
    p => p.type === 'CHARACTER' && p.controlledBy !== 'user' && p.connectionProfileId,
  )
  const anySeat = llmSeat ?? chat.participants.find(p => p.connectionProfileId)
  return anySeat?.connectionProfileId ?? null
}

/** The prompt clock for a window: the calendar's zone at the window's instant. */
export function clockAt(ctx: Pick<ExtractionContext, 'clock'>, nowIso: string): ExtractionClock {
  return { nowIso, timelineMode: ctx.clock.timelineMode, timeZone: ctx.clock.timeZone }
}

async function hydrate(
  characterId: string,
  chatId: string,
): Promise<Character | null> {
  try {
    return await getRepositories().characters.findById(characterId)
  } catch (error) {
    logger.debug('[Memory] Character unavailable to extraction; leaving it out', {
      chatId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** The description of the chat's project, as background. Null when absent or unreadable. */
async function loadProjectDescription(projectId: string | null, chatId: string): Promise<string | null> {
  if (!projectId) return null
  try {
    return (await getRepositories().projects.findById(projectId))?.description ?? null
  } catch (error) {
    logger.debug('[Memory] Project description unavailable; continuing without it', {
      chatId,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Build the context for one unit of work. Throws {@link ExtractionContextError}
 * when the chat is gone or no connection profile can be found; anything else
 * missing (a character, the project, the Concierge policy) degrades.
 */
export async function buildExtractionContext(
  chatId: string,
  userId: string,
  opts: BuildExtractionContextOptions = {},
): Promise<ExtractionContext> {
  const repos = getRepositories()
  const chat = opts.chat ?? (await repos.chats.findById(chatId))
  if (!chat) throw new ExtractionContextError('no-chat', `Chat not found: ${chatId}`)

  let connectionProfile = opts.connectionProfile ?? null
  if (!connectionProfile) {
    const profileId = opts.connectionProfileId ?? pickExtractionConnectionProfileId(chat)
    connectionProfile = profileId ? await repos.connections.findById(profileId) : null
  }
  if (!connectionProfile) {
    throw new ExtractionContextError('no-connection-profile', `No connection profile for extraction on chat ${chatId}`)
  }

  const [chatSettings, availableProfiles, settings, timeZone] = await Promise.all([
    repos.chatSettings.findByUserId(userId),
    repos.connections.findByUserId(userId),
    resolveMemorySettings(userId),
    refreshMemoryTimeZone(),
  ])

  // The cast: every CHARACTER seat, hydrated once.
  const cast = new Map<string, CastMember>()
  for (const p of chat.participants) {
    if (p.type !== 'CHARACTER' || !p.characterId || cast.has(p.characterId)) continue
    const character = await hydrate(p.characterId, chatId)
    if (!character) continue
    cast.set(p.characterId, {
      characterId: character.id,
      participantId: p.id,
      name: character.name,
      pronouns: character.pronouns ?? null,
      isUser: p.controlledBy === 'user',
      present: isParticipantPresent(p.status),
      character,
    })
  }
  for (const id of opts.extraCharacterIds ?? []) {
    if (cast.has(id)) continue
    const character = await hydrate(id, chatId)
    if (!character) continue
    cast.set(id, {
      characterId: character.id,
      participantId: null,
      name: character.name,
      pronouns: character.pronouns ?? null,
      isUser: false,
      present: false,
      character,
    })
  }
  const userSeat = chat.participants.find(p => p.type === 'CHARACTER' && p.controlledBy === 'user' && p.characterId)
  const userCharacter = userSeat?.characterId ? cast.get(userSeat.characterId) ?? null : null

  const projectId = chat.projectId ?? null
  const [projectDescription, speakerNames] = await Promise.all([
    loadProjectDescription(projectId, chatId),
    resolveSpeakerNames(chat),
  ])

  const route = resolveExtractionRoute({ chat, connectionProfile, chatSettings, availableProfiles })
  const dryRun = opts.dryRun === true

  const selfCanon = new Map<string, Promise<string>>()
  const otherCanon = new Map<string, Promise<{ block: string; source: string }>>()
  let messagesPromise: Promise<MessageEvent[]> | null = opts.messages ? Promise.resolve(opts.messages) : null

  const ctx: ExtractionContext = {
    chat,
    userId,
    clock: { timeZone, nowMs: Date.now(), timelineMode: chat.timelineMode ?? 'realtime' },
    settings: settings.extraction,
    cast,
    userCharacter,
    speakerNames,
    canonForSelf(holderId) {
      let block = selfCanon.get(holderId)
      if (!block) {
        const c = cast.get(holderId)?.character
        block = loadCanonForSelfWithCommonplace({
          id: holderId,
          name: c?.name ?? cast.get(holderId)?.name ?? holderId,
          manifesto: c?.manifesto ?? null,
          personality: c?.personality ?? null,
          description: c?.description ?? null,
          identity: c?.identity ?? null,
          mountPointId: c?.characterDocumentMountPointId ?? null,
        }).then(renderSelfCanonBlock)
        selfCanon.set(holderId, block)
      }
      return block
    },
    canonFor(holderId, aboutId) {
      const key = `${holderId}\u0000${aboutId}`
      let entry = otherCanon.get(key)
      if (!entry) {
        const holder = cast.get(holderId)?.character
        const about = cast.get(aboutId)
        entry = loadCanonForObserverAboutSubject(
          { characterId: holderId, mountPointId: holder?.characterDocumentMountPointId ?? null },
          {
            id: aboutId,
            name: about?.name ?? aboutId,
            identity: about?.character.identity ?? null,
            description: about?.character.description ?? null,
          },
        ).then(canon => ({ block: renderOtherCanonBlock(canon), source: canon.source }))
        otherCanon.set(key, entry)
      }
      return entry
    },
    project: { id: projectId, description: projectDescription },
    orienting: {
      projectDescription,
      chatContextSummary: opts.chatContextSummary !== undefined ? opts.chatContextSummary : chat.contextSummary ?? null,
    },
    route,
    rateLimit: createRateLimiter(
      opts.backfill ? { ...settings.extraction.limits, enabled: false } : settings.extraction.limits,
    ),
    cursors: opts.cursors ?? (dryRun ? memoryCursorStore(chatId) : liveCursorStore(chatId)),
    dryRun,
    backfill: opts.backfill === true,
    inAutonomousRoom: chat.chatType === 'autonomous',
    messages() {
      if (!messagesPromise) {
        messagesPromise = repos.chats.getMessages(chatId).then(
          rows => rows.filter((m): m is MessageEvent => m.type === 'message') as unknown as MessageEvent[],
        )
      }
      return messagesPromise
    },
  }

  logger.debug('[Memory] Extraction context built', {
    chatId,
    dryRun,
    backfill: opts.backfill === true,
    cast: cast.size,
    userCharacterId: userCharacter?.characterId ?? null,
    projectId,
    hasProjectDescription: projectDescription !== null,
    timeZone,
    otherPass: settings.extraction.mode.otherPass,
    rateLimited: settings.extraction.limits.enabled,
  })
  return ctx
}
