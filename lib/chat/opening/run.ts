/**
 * The opening — everything between a chat being cast and its first line.
 *
 * Casting (`cast.ts`) creates the row and returns at once with the chat
 * `'pending'`. The opening is a separate operation on that existing chat,
 * started by whoever first needs it opened: the Salon when it opens a chat
 * that is not `'done'` (a continue-mode stream with `opening: true`), an
 * autonomous room's run start, or `POST /api/v1/chats/[id]?action=open`.
 *
 * It is a walk over {@link OPENING_PHASES}, in order, skipping the phases that
 * do not apply to the chat's flavour — a fresh Salon chat, a continuation, an
 * autonomous room. After each phase the row records it (`openingPhase`), so an
 * opening broken off by a closed tab or a restart resumes at the next phase;
 * every phase is idempotent against the row besides. A stop (the Salon's Stop
 * button, which reaches the opening because it runs inside the stream's
 * turn-control handle) skips what is left — what was dressed and packed
 * stays — and the chat is opened without its greeting.
 *
 * One opening per chat at a time, in this process: a second caller waits for
 * the first and finds the chat opened. A send made meanwhile waits too
 * (`waitForOpening`).
 *
 * Server-only. Parent-process only: it writes.
 *
 * Design of record: docs/developer/features/refactor-green-room-and-opening.md (D1, D6, D10)
 *
 * @module chat/opening/run
 */

import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types'
import type { OutfitSelection } from '@/lib/schemas/wardrobe.types'
import { isCurrentTurnStopped } from '@/lib/chat/turn-control'
import { publishRealtime } from '@/lib/realtime/bus'
import { processSingleton } from '@/lib/utils/process-singleton'
import { compileAllIdentityStacks } from '@/lib/services/system-prompt-compiler/compiler'
import { inertNarrator, type GreenRoomNarrator } from './narrator'
import { seatArrivals } from './arrival'
import { postHostScenarioOpening, postHostUserCharacterOpening, postProsperoOpening } from './staff'

/** The three kinds of chat an opening knows. */
export type OpeningFlavour = 'salon' | 'continuation' | 'autonomous'

/** What casting asked of the opening, kept on the row until it finishes. */
export interface OpeningPlan {
  /** The operator's outfit choices; a seat not named arrives in the default mode. */
  outfitSelections?: OutfitSelection[]
  /** A continuation's source chat. */
  sourceChatId?: string | null
}

/** Who asked for the opening. */
export type OpeningTrigger =
  /** The Salon, `?action=open`, or anyone else opening the chat for its own sake. */
  | 'open'
  /** An autonomous room's run start, which starts the run itself afterwards. */
  | 'run-start'

export interface OpeningContext {
  repos: RepositoryContainer
  chat: ChatMetadata
  userId: string
  flavour: OpeningFlavour
  plan: OpeningPlan
  trigger: OpeningTrigger
  narrator: GreenRoomNarrator
  /** The opening was broken off before and is picking up where it stopped. */
  resuming: boolean
  /** Run the greeting as a turn on the caller's stream. Absent → no greeting. */
  greet?: () => Promise<void>
}

export interface OpeningPhase {
  key: string
  /** The Green Room's headline while the phase runs. */
  label: string
  appliesTo: (flavour: OpeningFlavour) => boolean
  /**
   * Runs after the chat is marked opened, and is never resumed: an autonomous
   * room's run start, which itself waits for the chat to be opened.
   */
  afterOpened?: boolean
  run: (ctx: OpeningContext) => Promise<void>
}

const always = () => true

/**
 * The opening, in order. The order of the staff's rows in a new chat is
 * visible in every transcript and does not change: Prospero's briefing and
 * per-seat whispers, the Host's scenario, the Host's introduction of the
 * operator's character, then each arrival (the Host's welcomes, then Aurora's
 * opening outfits), then the greeting.
 */
export const OPENING_PHASES: readonly OpeningPhase[] = [
  {
    key: 'stacks',
    label: 'Committing everyone’s particulars to memory…',
    appliesTo: always,
    run: async ({ chat }) => {
      try {
        await compileAllIdentityStacks(chat)
      } catch (error) {
        // Non-fatal: the per-turn builder's read-through fallback rebuilds on a miss.
        logger.warn('[Opening] Failed to compile identity stacks', { chatId: chat.id, error: getErrorMessage(error) })
      }
    },
  },
  {
    key: 'prospero',
    label: 'Briefing the house on the project at hand…',
    appliesTo: always,
    run: ({ repos, chat, resuming }) => postProsperoOpening(repos, chat, { resuming }),
  },
  {
    key: 'host-scenario',
    label: 'Setting the opening scene…',
    appliesTo: always,
    run: ({ repos, chat, resuming }) => postHostScenarioOpening(repos, chat, { resuming }),
  },
  {
    key: 'host-user-character',
    label: 'Announcing you to the company…',
    appliesTo: always,
    run: ({ repos, chat, resuming }) => postHostUserCharacterOpening(repos, chat, { resuming }),
  },
  {
    key: 'arrivals',
    label: 'Consulting the wardrobe…',
    appliesTo: always,
    run: async ({ repos, chat, userId, plan, narrator }) => {
      const seats = chat.participants
        .filter((p) => p.type === 'CHARACTER' && p.characterId && p.status !== 'removed')
        .map((p) => ({
          characterId: p.characterId as string,
          outfitSelection: plan.outfitSelections?.find((s) => s.characterId === p.characterId),
        }))
      await seatArrivals(repos, chat.id, seats, {
        source: 'chat-start',
        userId,
        sourceChatId: plan.sourceChatId ?? null,
        narrator,
      })
    },
  },
  {
    key: 'greeting',
    label: 'The curtain rises…',
    appliesTo: (flavour) => flavour === 'salon',
    run: async ({ repos, chat, greet }) => {
      if (!greet) return
      if (await hasOpener(repos, chat.id)) {
        logger.debug('[Opening] The chat already has its first line; no greeting', { chatId: chat.id })
        return
      }
      await greet()
    },
  },
  {
    key: 'autonomous-start',
    label: 'Ringing up the room to begin…',
    appliesTo: (flavour) => flavour === 'autonomous',
    afterOpened: true,
    run: async ({ chat, userId, trigger }) => {
      // A room started by its own run start is already starting; a scheduled
      // room waits for its schedule. Only an ad-hoc room opened for its own
      // sake starts itself, as it always has on creation.
      if (trigger !== 'open' || chat.scheduleCron) return
      const { startAutonomousRoomManually } = await import('@/lib/services/chat-message/autonomous-room.service')
      try {
        const result = await startAutonomousRoomManually(chat.id, userId)
        if (!result.ok) {
          logger.warn('[Opening] Start of ad-hoc autonomous room declined', { chatId: chat.id, reason: result.reason })
        }
      } catch (error) {
        logger.error('[Opening] Start of ad-hoc autonomous room threw', { chatId: chat.id, error: getErrorMessage(error) })
      }
    },
  },
]

/** Whether the chat already has a character's line or the operator's (the greeting's idempotence check). */
async function hasOpener(repos: RepositoryContainer, chatId: string): Promise<boolean> {
  const messages = await repos.chats.getMessages(chatId)
  return messages.some((m) => {
    if (m.type !== 'message') return false
    const msg = m as MessageEvent
    if (msg.systemSender) return false
    return msg.role === 'USER' || (msg.role === 'ASSISTANT' && !!msg.participantId)
  })
}

/** The chat's flavour, as the phase table reads it. */
export function openingFlavourOf(chat: Pick<ChatMetadata, 'chatType'>, plan: OpeningPlan): OpeningFlavour {
  if (chat.chatType === 'autonomous') return 'autonomous'
  return plan.sourceChatId ? 'continuation' : 'salon'
}

function readPlan(raw: unknown): OpeningPlan {
  if (!raw || typeof raw !== 'object') return {}
  const plan = raw as OpeningPlan
  return {
    outfitSelections: Array.isArray(plan.outfitSelections) ? plan.outfitSelections : undefined,
    sourceChatId: typeof plan.sourceChatId === 'string' ? plan.sourceChatId : null,
  }
}

// ---------------------------------------------------------------------------
// One opening per chat
// ---------------------------------------------------------------------------

const inFlight = processSingleton('chat.openings', () => new Map<string, Promise<void>>())

/** Wait for this chat's opening, if one is running in this process. */
export async function waitForOpening(chatId: string): Promise<void> {
  const running = inFlight.get(chatId)
  if (!running) return
  logger.debug('[Opening] Waiting for the chat to finish opening', { chatId })
  await running.catch(() => {})
}

export interface RunOpeningInput {
  repos: RepositoryContainer
  chatId: string
  userId: string
  trigger: OpeningTrigger
  narrator?: GreenRoomNarrator
  greet?: () => Promise<void>
}

/**
 * Open a chat: walk the phases not yet done. A chat already opened is left
 * alone; a second caller while one runs waits for it. Never throws for a
 * phase's failure — every phase fails soft and the opening goes on.
 */
export async function runOpening(input: RunOpeningInput): Promise<void> {
  const running = inFlight.get(input.chatId)
  if (running) {
    await waitForOpening(input.chatId)
    return
  }
  const work = walkPhases(input)
  inFlight.set(input.chatId, work)
  try {
    await work
  } finally {
    inFlight.delete(input.chatId)
  }
}

async function walkPhases(input: RunOpeningInput): Promise<void> {
  const { repos, chatId, userId, trigger } = input
  const narrator = input.narrator ?? inertNarrator
  const stored = await repos.chats.getOpeningState(chatId)
  if (stored.state === 'done') {
    logger.debug('[Opening] Chat already opened', { chatId, trigger })
    return
  }
  const initial = await repos.chats.findById(chatId)
  if (!initial) {
    logger.warn('[Opening] No such chat; nothing to open', { chatId })
    return
  }
  const plan = readPlan(stored.plan)
  // A phase on record, or a run left 'running', means an earlier attempt broke off.
  const resuming = stored.phase !== null || stored.state === 'running'
  const flavour = openingFlavourOf(initial, plan)
  const resumeAfter = stored.phase ? OPENING_PHASES.findIndex((p) => p.key === stored.phase) : -1
  const remaining = OPENING_PHASES.slice(resumeAfter + 1).filter((p) => p.appliesTo(flavour))

  logger.info('[Opening] Opening the chat', {
    chatId,
    flavour,
    trigger,
    resumingAfter: stored.phase,
    resuming,
    phases: remaining.map((p) => p.key),
  })
  await repos.chats.setOpeningState(chatId, 'running')

  let stopped = false
  let opened = false
  const markOpened = async () => {
    if (opened) return
    opened = true
    await repos.chats.setOpeningState(chatId, 'done', undefined, null)
    narrator.done()
    publishRealtime('chats', chatId)
    logger.info('[Opening] Chat opened', { chatId, flavour, stopped })
  }

  for (const phase of remaining) {
    if (isCurrentTurnStopped()) {
      stopped = true
      logger.info('[Opening] Stopped by the operator; the rest of the opening is skipped', { chatId, at: phase.key })
      break
    }
    if (phase.afterOpened) await markOpened()
    // Every phase reads the chat as the phases before it left it.
    const chat = (await repos.chats.findById(chatId)) ?? initial
    narrator.phase(phase.key, phase.label)
    narrator.status(phase.label)
    const startedAt = Date.now()
    try {
      await phase.run({ repos, chat, userId, flavour, plan, trigger, narrator, resuming, greet: input.greet })
    } catch (error) {
      logger.error('[Opening] Phase failed; the opening goes on', {
        chatId,
        phase: phase.key,
        error: getErrorMessage(error),
      }, error instanceof Error ? error : undefined)
    }
    logger.debug('[Opening] Phase finished', { chatId, phase: phase.key, elapsedMs: Date.now() - startedAt })
    if (!opened) await repos.chats.setOpeningState(chatId, 'running', phase.key)
  }
  await markOpened()
}

/** An opening left `'running'` longer than this at boot was broken off. */
export const STALE_OPENING_MS = 10 * 60 * 1000

/**
 * At startup: return openings broken off by a restart — `'running'` for
 * longer than {@link STALE_OPENING_MS} — to `'pending'`, keeping their phase,
 * so the list says "not yet opened" and the next open resumes them.
 */
export async function reconcileStaleOpeningsAtStartup(repos: RepositoryContainer): Promise<number> {
  const olderThan = new Date(Date.now() - STALE_OPENING_MS).toISOString()
  const reset = await repos.chats.resetStaleOpenings(olderThan)
  if (reset > 0) logger.info('[Opening] Returned broken-off openings to pending', { reset, olderThan })
  else logger.debug('[Opening] No broken-off openings at startup', { olderThan })
  return reset
}
