/**
 * A hand-built `ExtractionContext` for unit tests of the extraction passes
 * (`lib/memory/extraction/`), so a suite can drive `runPass`,
 * `runTurnPasses`, `runFoldPass` and the catch-ups without the database.
 *
 * Mock `executeCheapLLMTask` (`@/lib/memory/cheap-llm-tasks/core-execution`)
 * and `admitCandidate` (`@/lib/memory/admission`) in the suite; this helper
 * only supplies the context.
 */

import type { Character, ChatMetadata, ChatParticipantBase, MessageEvent } from '@/lib/schemas/types'
import type { CastMember, ExtractionContext } from '@/lib/memory/extraction/context'
import { memoryCursorStore } from '@/lib/memory/extraction/cursors'
import { createRateLimiter } from '@/lib/memory/extraction/rate-limit'
import type { MemoryExtractionLimits, MemoryExtractionModeSettings } from '@/lib/schemas/settings.types'

export interface TestSeat {
  characterId: string
  name: string
  participantId?: string
  isUser?: boolean
  present?: boolean
  pronouns?: CastMember['pronouns']
  character?: Partial<Character>
}

export interface TestContextOptions {
  chatId?: string
  userId?: string
  seats?: TestSeat[]
  /** Characters outside the chat (a Carina answerer). */
  extras?: TestSeat[]
  messages?: MessageEvent[]
  chat?: Partial<ChatMetadata>
  mode?: Partial<MemoryExtractionModeSettings>
  limits?: Partial<MemoryExtractionLimits>
  /** Baseline admissions per character for the rate limiter. */
  recentAdmissions?: Record<string, number>
  maxTokens?: number
  dryRun?: boolean
  backfill?: boolean
  timeZone?: string
  projectId?: string | null
  projectDescription?: string | null
  chatContextSummary?: string | null
  cursors?: Partial<Record<'other-fold' | 'episode-fold', string>>
}

export const DEFAULT_MODE: MemoryExtractionModeSettings = {
  otherPass: 'turn',
  perTurnOtherFloor: 0.75,
  foldCandidatesPerSubject: 3,
} as MemoryExtractionModeSettings

export const DEFAULT_LIMITS: MemoryExtractionLimits = {
  enabled: false,
  maxPerHour: 20,
  softStartFraction: 0.7,
  softFloor: 0.7,
} as MemoryExtractionLimits

function member(seat: TestSeat, seated: boolean): CastMember {
  return {
    characterId: seat.characterId,
    participantId: seated ? (seat.participantId ?? `p-${seat.characterId}`) : null,
    name: seat.name,
    pronouns: seat.pronouns ?? null,
    isUser: seat.isUser === true,
    present: seated ? seat.present !== false : false,
    character: {
      id: seat.characterId,
      name: seat.name,
      identity: null,
      description: null,
      manifesto: null,
      personality: null,
      characterDocumentMountPointId: null,
      ...seat.character,
    } as Character,
  }
}

/** The chat participants the seats describe. */
export function participantsFor(seats: TestSeat[]): ChatParticipantBase[] {
  return seats.map((s, i) => ({
    id: s.participantId ?? `p-${s.characterId}`,
    type: 'CHARACTER',
    characterId: s.characterId,
    controlledBy: s.isUser ? 'user' : 'llm',
    displayOrder: i,
    isActive: true,
    status: s.present === false ? 'absent' : 'active',
    connectionProfileId: s.isUser ? null : 'profile-1',
  })) as unknown as ChatParticipantBase[]
}

export function makeExtractionContext(opts: TestContextOptions = {}): ExtractionContext {
  const chatId = opts.chatId ?? 'chat-1'
  const seats = opts.seats ?? []
  const cast = new Map<string, CastMember>()
  for (const s of seats) cast.set(s.characterId, member(s, true))
  for (const s of opts.extras ?? []) cast.set(s.characterId, member(s, false))
  const userSeat = seats.find(s => s.isUser)
  const limits = { ...DEFAULT_LIMITS, ...opts.limits }
  const chat = {
    id: chatId,
    userId: opts.userId ?? 'user-1',
    participants: participantsFor(seats),
    chatType: 'salon',
    timelineMode: 'realtime',
    projectId: opts.projectId ?? null,
    contextSummary: null,
    ...opts.chat,
  } as unknown as ChatMetadata
  const speakerNames = new Map<string, string>()
  for (const m of cast.values()) if (m.participantId) speakerNames.set(m.participantId, m.name)

  return {
    chat,
    userId: opts.userId ?? 'user-1',
    clock: { timeZone: opts.timeZone ?? 'UTC', nowMs: Date.parse('2026-07-14T12:00:00.000Z'), timelineMode: chat.timelineMode ?? 'realtime' },
    settings: {
      mode: { ...DEFAULT_MODE, ...opts.mode } as MemoryExtractionModeSettings,
      limits,
    },
    cast,
    userCharacter: userSeat ? cast.get(userSeat.characterId) ?? null : null,
    speakerNames,
    canonForSelf: async (holderId: string) => `SELF CANON ${holderId}`,
    canonFor: async (holderId: string, aboutId: string) => ({ block: `CANON ${holderId}→${aboutId}`, source: 'identity' }),
    project: { id: opts.projectId ?? null, description: opts.projectDescription ?? null },
    orienting: { projectDescription: opts.projectDescription ?? null, chatContextSummary: opts.chatContextSummary ?? null },
    route: {
      cheapLLM: { provider: 'OPENAI', modelName: 'cheap-model', isLocal: false } as ExtractionContext['route']['cheapLLM'],
      uncensoredFallback: null,
      maxTokens: opts.maxTokens ?? 16000,
      connectionProfile: { id: 'profile-1', provider: 'OPENAI', modelName: 'model' } as ExtractionContext['route']['connectionProfile'],
    },
    rateLimit: createRateLimiter(limits, async (characterId: string) => opts.recentAdmissions?.[characterId] ?? 0),
    cursors: memoryCursorStore(chatId, opts.cursors ?? {}),
    dryRun: opts.dryRun === true,
    backfill: opts.backfill === true,
    dryRunBook: null,
    inAutonomousRoom: chat.chatType === 'autonomous',
    messages: async () => opts.messages ?? [],
  }
}

/** A spoken chat message for a seat. */
export function seatMessage(
  id: string,
  seat: TestSeat,
  content: string,
  createdAt: string,
  extra: Partial<MessageEvent> = {},
): MessageEvent {
  return {
    id,
    type: 'message',
    role: seat.isUser ? 'USER' : 'ASSISTANT',
    content,
    createdAt,
    participantId: seat.participantId ?? `p-${seat.characterId}`,
    attachments: [],
    ...extra,
  } as unknown as MessageEvent
}
