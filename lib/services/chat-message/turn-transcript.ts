/**
 * Turn Transcript Builder
 *
 * Per-turn memory extraction: instead of running extraction once per
 * assistant message (with each pass seeing only its own slice), we wait
 * until the turn closes and run extraction once against a joined transcript
 * of the whole turn — the user message that opened it plus every character
 * response that followed, keyed by character.
 *
 * "Turn opener" is the most recent non-system USER message. The turn closes
 * when control returns to the user (turnInfo.isUsersTurn === true on the
 * last finalizer of the turn).
 */

import type { Character, ChatParticipantBase, MessageEvent } from '@/lib/schemas/types'
import type { Pronouns } from '@/lib/schemas/character.types'

export interface TurnCharacterSlice {
  characterId: string
  characterName: string
  characterPronouns?: Pronouns | null
  /** Joined text from every assistant message this character contributed during the turn, in chronological order. */
  text: string
  /** Every assistant message ID that contributed to this slice. */
  contributingMessageIds: string[]
  /**
   * `createdAt` of the slice's most recent contributing message — the
   * wall-clock anchor used to stamp `occurredAt` on memories derived from
   * this slice (episodic spine). Null when the source event carried no
   * timestamp.
   */
  lastMessageCreatedAt?: string | null
  /**
   * True when this slice's text was authored by the human driving a
   * user-controlled character (role: 'USER'), not by an LLM. Such a slice is
   * built from the turn opener so the user-controlled character forms its own
   * SELF and OTHER memories from the turns the human plays it.
   */
  isUserControlled?: boolean
}

export interface TurnTranscript {
  /** ID of the USER message that opened the turn, or null for greeting/continue turns with no fresh user input. */
  turnOpenerMessageId: string | null
  /** Verbatim user-message text, or null when the turn has no user opener. */
  userMessage: string | null
  /** Resolved user-controlled character (if any). */
  userCharacterId?: string
  userCharacterName?: string
  userCharacterPronouns?: Pronouns | null
  /** ASSISTANT participants that spoke during the turn, ordered by first contribution. */
  characterSlices: TurnCharacterSlice[]
  /**
   * Lines of this turn an earlier committed extraction already covered (the
   * part at or before `extractAfterMessageId`), grouped the same way. Context
   * only: rendered under their own heading, never extraction material, and
   * capped at {@link PRIOR_CONTEXT_MAX_MESSAGES} messages. Absent when the
   * whole turn is new (bug 245).
   */
  priorSlices?: TurnCharacterSlice[]
  /** The most recent ASSISTANT message ID in the turn — used as sourceMessageId on derived memories. */
  latestAssistantMessageId: string | null
  /**
   * Wall-clock anchor for the whole turn: `createdAt` of the most recent
   * message collected (opener or assistant). Feeds the extraction CLOCK and
   * the fallback `occurredAt` stamp. Null when nothing carried a timestamp.
   */
  turnTimestamp: string | null
}

/**
 * A chat's message rows (`type: 'message'`), chronological — the one read of
 * a transcript every extraction path starts from.
 */
export async function loadChatMessageEvents(chatId: string): Promise<MessageEvent[]> {
  const { getRepositories } = await import('@/lib/repositories/factory')
  return (await getRepositories().chats.getMessages(chatId)).filter(
    (m) => m.type === 'message',
  ) as unknown as MessageEvent[]
}

/**
 * Find the most recent non-system USER message in chat history.
 * Returns null if no qualifying user message exists (fresh chat, greeting-only).
 */
export function findTurnOpenerMessageId(messages: MessageEvent[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type !== 'message') continue
    if (m.role !== 'USER') continue
    if (m.systemSender) continue
    return m.id
  }
  return null
}

/**
 * The latest message that closes an autonomous-room turn: a non-staff,
 * non-silent ASSISTANT line from a seat. Null when there is none.
 */
export function findAutonomousTurnAnchorMessageId(messages: MessageEvent[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isAutonomousTurnAnchor(messages[i])) return messages[i].id
  }
  return null
}

function isAutonomousTurnAnchor(m: MessageEvent): boolean {
  return m.type === 'message' && m.role === 'ASSISTANT' && !m.systemSender && !m.isSilentMessage && !!m.participantId
}

/** How a turn is addressed for extraction: its USER opener, and (autonomous rooms) the message that closes it. */
export interface ExtractionTurnLocator {
  turnOpenerMessageId: string | null
  extractionAnchorMessageId?: string | null
  /**
   * Lines at or before this message are context, not material (bug 245). Set
   * by {@link listExtractionTurns} for an autonomous room (the previous
   * speaker's anchor); a live job takes it from the chat's `turn` cursor.
   */
  extractAfterMessageId?: string | null
}

/** The most already-extracted messages a transcript keeps as context (bug 245). */
export const PRIOR_CONTEXT_MAX_MESSAGES = 8

/**
 * Every turn of a chat, as extraction addresses them — the one scan the
 * queue-memories action, the dry run, the regenerate and the SillyTavern
 * import share.
 *
 *  - An ordinary chat: one null-opener turn for the greeting when any
 *    character line comes before the first user message (the live trigger
 *    enqueues it when the greeting finalizes), then one turn per non-staff
 *    USER message (each opens a turn). A chat with no user message and some
 *    character line is just the greeting turn; with neither, no turns.
 *  - An autonomous room: no USER opener ever, so one turn per closing
 *    ASSISTANT line, each anchored on it (the live trigger's shape).
 */
export function listExtractionTurns(
  messages: MessageEvent[],
  chatType: string | null | undefined,
): ExtractionTurnLocator[] {
  if (chatType === 'autonomous') {
    // Each speaker's turn is read past the previous anchor; without the bound
    // every job would re-read the room from its first line (bug 245).
    const anchors = messages.filter(isAutonomousTurnAnchor)
    return anchors.map((m, i) => ({
      turnOpenerMessageId: null,
      extractionAnchorMessageId: m.id,
      extractAfterMessageId: i > 0 ? anchors[i - 1].id : null,
    }))
  }
  const isOpener = (m: MessageEvent) => m.type === 'message' && m.role === 'USER' && !m.systemSender
  const firstOpener = messages.findIndex(isOpener)
  const beforeFirstOpener = firstOpener === -1 ? messages : messages.slice(0, firstOpener)
  const turns: ExtractionTurnLocator[] = beforeFirstOpener.some(isAutonomousTurnAnchor) ? [{ turnOpenerMessageId: null }] : []
  for (const m of messages) if (isOpener(m)) turns.push({ turnOpenerMessageId: m.id })
  return turns
}

/**
 * Resolve the user-controlled character (if any) from a chat's participants,
 * hydrated from a map of the chat's `Character` records.
 *
 * Quilltap is single-user per instance: at most one CHARACTER participant is
 * marked as the user persona. When none exists — or its Character record is
 * missing from the map — the caller simply omits the user from its subject set.
 *
 * Lives here because every caller is feeding {@link buildTurnTranscript}'s
 * `userCharacter*` options, which is exactly what this returns.
 */
export function resolveUserCharacterParticipant(
  participants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>,
): { id: string; name: string; pronouns: Character['pronouns'] | null } | undefined {
  const userCharParticipant = participants.find(
    p => p.type === 'CHARACTER' && p.controlledBy === 'user' && p.characterId,
  )
  if (!userCharParticipant || userCharParticipant.type !== 'CHARACTER' || !userCharParticipant.characterId) {
    return undefined
  }
  const character = participantCharacters.get(userCharParticipant.characterId)
  if (!character) return undefined
  return { id: character.id, name: character.name, pronouns: character.pronouns ?? null }
}

interface BuildTurnTranscriptOptions {
  /** The USER message that opened the turn. Pass null for greeting-only turns. */
  turnOpenerMessageId: string | null
  /**
   * Optional terminal ASSISTANT message ID. When set, the forward walk
   * stops after collecting the message whose id matches — used by
   * autonomous chats so each speaker's turn becomes its own transcript
   * rather than re-extracting the whole tail every time.
   */
  extractionAnchorMessageId?: string | null
  /**
   * The last message an earlier extraction of this stretch covered. When it is
   * one of the turn's own assistant lines, everything up to and including it
   * (the opener's slice too) becomes `priorSlices` — context, not material.
   * A bound outside the turn (an older turn's line, or a later one from a
   * concurrent job) is ignored, so it can never hide a turn's own lines (bug 245).
   */
  extractAfterMessageId?: string | null
  userCharacterId?: string
  userCharacterName?: string
  userCharacterPronouns?: Pronouns | null
}

interface TurnLine {
  message: MessageEvent
  character: Character
}

/** Group lines into per-speaker slices, ordered by first contribution. */
function groupIntoSlices(lines: readonly TurnLine[]): TurnCharacterSlice[] {
  const slices = new Map<string, TurnCharacterSlice>()
  for (const { message: m, character } of lines) {
    const existing = slices.get(character.id)
    if (existing) {
      existing.text = existing.text.length
        ? `${existing.text}\n\n${m.content}`
        : m.content
      existing.contributingMessageIds.push(m.id)
      existing.lastMessageCreatedAt = m.createdAt ?? existing.lastMessageCreatedAt
    } else {
      slices.set(character.id, {
        characterId: character.id,
        characterName: character.name,
        characterPronouns: character.pronouns ?? null,
        text: m.content,
        contributingMessageIds: [m.id],
        lastMessageCreatedAt: m.createdAt ?? null,
      })
    }
  }
  return [...slices.values()]
}

/**
 * The turn as one stretch of material: its already-extracted lines folded back
 * into the slices they belong to (prior lines first). For an observer who
 * joined the turn after an earlier extraction, everything said in it is new
 * (bug 245). A transcript with no prior lines is returned as it is.
 */
export function withPriorAsMaterial(transcript: TurnTranscript): TurnTranscript {
  if (!transcript.priorSlices?.length) return transcript
  const merged = new Map<string, TurnCharacterSlice>()
  for (const slice of [...transcript.priorSlices, ...transcript.characterSlices]) {
    const key = `${slice.isUserControlled ? 'user' : 'ai'}:${slice.characterId}`
    const existing = merged.get(key)
    if (existing) {
      merged.set(key, {
        ...existing,
        text: `${existing.text}\n\n${slice.text}`,
        contributingMessageIds: [...existing.contributingMessageIds, ...slice.contributingMessageIds],
        lastMessageCreatedAt: slice.lastMessageCreatedAt ?? existing.lastMessageCreatedAt,
      })
    } else {
      merged.set(key, { ...slice, contributingMessageIds: [...slice.contributingMessageIds] })
    }
  }
  const { priorSlices: _prior, ...rest } = transcript
  return { ...rest, characterSlices: [...merged.values()] }
}

/**
 * Build a per-turn transcript from chat history.
 *
 * Walks forward from the turn opener (exclusive) to the end of the message list,
 * grouping ASSISTANT messages by participantId. Skips system whispers (Host,
 * Librarian, Concierge, etc.), tool messages, and silent-mode messages — none
 * of those represent participant speech.
 *
 * If `turnOpenerMessageId` is null we treat every assistant message in the
 * history as belonging to "the current turn"; the user-message side of the
 * transcript is null and the user-pass extraction skips itself. When
 * `extractionAnchorMessageId` is set, the walk stops after collecting the
 * anchor — autonomous chats use this to bound each character's slice.
 */
export function buildTurnTranscript(
  messages: MessageEvent[],
  participants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>,
  options: BuildTurnTranscriptOptions,
): TurnTranscript {
  const lines: TurnLine[] = []
  let userMessage: string | null = null
  let userSlice: TurnCharacterSlice | null = null
  let latestAssistantMessageId: string | null = null
  let turnTimestamp: string | null = null

  let scanning = options.turnOpenerMessageId === null
  for (const m of messages) {
    if (m.type !== 'message') continue

    if (!scanning) {
      if (m.id === options.turnOpenerMessageId && m.role === 'USER') {
        userMessage = m.content
        scanning = true
        turnTimestamp = m.createdAt ?? turnTimestamp
        // Promote a user-controlled opener to a first-class slice so its driver
        // forms memories. The opener's participantId authoritatively identifies
        // which user character spoke this turn (more reliable than the singular
        // userCharacterId option, which is just the first user-controlled
        // participant). Built before the forward walk; prepended below so it
        // reads first chronologically.
        const openerParticipant = participants.find(p => p.id === m.participantId)
        if (
          openerParticipant?.type === 'CHARACTER' &&
          openerParticipant.controlledBy === 'user' &&
          openerParticipant.characterId
        ) {
          const character = participantCharacters.get(openerParticipant.characterId)
          if (character) {
            userSlice = {
              characterId: character.id,
              characterName: character.name,
              characterPronouns: character.pronouns ?? null,
              text: m.content,
              contributingMessageIds: [m.id],
              lastMessageCreatedAt: m.createdAt ?? null,
              isUserControlled: true,
            }
          }
        }
      }
      continue
    }

    if (m.role === 'USER' && !m.systemSender) {
      break
    }

    if (m.systemSender) continue
    if (m.role !== 'ASSISTANT') continue
    if (m.isSilentMessage) continue
    if (!m.participantId) continue

    const participant = participants.find(p => p.id === m.participantId)
    if (!participant || participant.type !== 'CHARACTER' || !participant.characterId) continue

    const character = participantCharacters.get(participant.characterId)
    if (!character) continue

    lines.push({ message: m, character })
    latestAssistantMessageId = m.id
    turnTimestamp = m.createdAt ?? turnTimestamp

    if (options.extractionAnchorMessageId && m.id === options.extractionAnchorMessageId) {
      break
    }
  }

  // Split at the bound when it is one of this turn's own lines (bug 245).
  const boundIndex = options.extractAfterMessageId
    ? lines.findIndex(l => l.message.id === options.extractAfterMessageId)
    : -1
  const material = boundIndex >= 0 ? lines.slice(boundIndex + 1) : lines
  const prior = boundIndex >= 0 ? lines.slice(0, boundIndex + 1).slice(-PRIOR_CONTEXT_MAX_MESSAGES) : []
  const materialSlices = groupIntoSlices(material)
  const priorSlices = groupIntoSlices(prior)
  // The opener was read with the turn's first extraction; once the bound is
  // inside the turn it is context too.
  if (userSlice) (boundIndex >= 0 ? priorSlices : materialSlices).unshift(userSlice)

  return {
    turnOpenerMessageId: options.turnOpenerMessageId,
    userMessage,
    userCharacterId: options.userCharacterId,
    userCharacterName: options.userCharacterName,
    userCharacterPronouns: options.userCharacterPronouns,
    characterSlices: materialSlices,
    ...(priorSlices.length > 0 ? { priorSlices } : {}),
    latestAssistantMessageId,
    turnTimestamp,
  }
}
