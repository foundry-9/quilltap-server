/**
 * Courier Transport Service
 *
 * Alternate dispatch path for manual / clipboard ("Courier") transport. When a
 * chat's effective connection profile uses Courier, the orchestrator does not
 * call an LLM at all — instead it renders the assembled request as Markdown,
 * persists a placeholder assistant message in `pendingExternalTurn` state,
 * pauses the chat, and emits SSE events so the Salon can show the Courier
 * bubble. The user pastes the LLM's reply back through the paste resolver,
 * which clears the pause.
 *
 * Delta mode: when the responding character already has a resolved Courier
 * checkpoint in this chat, we render a delta bundle (events after the
 * checkpoint) as the primary and keep the full bundle as a fallback the
 * bubble can switch to.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  renderCourierRequestAsMarkdown,
  renderCourierDeltaAsMarkdown,
  type CourierAttachmentDescriptor,
  type CourierCheckpoint,
  type CourierDeltaEvent,
} from '@/lib/llm/courier/render-markdown'
import {
  encodeDoneEvent,
  encodePendingExternalTurnEvent,
  safeEnqueue,
} from './streaming.service'

import type { LLMMessage } from '@quilltap/plugin-types'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadataBase, Character } from '@/lib/schemas/types'
import type { ProcessMessageResult, StreamingState } from './types'

const logger = createServiceLogger('CourierTransport')

const COURIER_SYSTEM_SENDER_LABELS: Record<string, string> = {
  lantern: 'The Lantern',
  aurora: 'Aurora',
  librarian: 'The Librarian',
  concierge: 'The Concierge',
  prospero: 'Prospero',
  host: 'The Host',
  commonplaceBook: 'The Commonplace Book',
  ariel: 'Ariel',
}

export interface DispatchCourierTransportOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: { id: string; status?: string }
  userParticipantId: string | null
  isMultiCharacter: boolean
  participantCharacters: Map<string, Character>
  resolvedIdentity: { name: string; description: string; characterId?: string | null }
  formattedMessages: unknown[]
  /** Read-only here; we only consult `effectiveProfile.{modelName, provider, courierDeltaMode}`. */
  streaming: StreamingState
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}

/**
 * Render the assembled request as Markdown, persist a placeholder assistant
 * message, pause the chat, and emit SSE events so the Salon can render the
 * Courier bubble. Returns the orchestrator's standard ProcessMessageResult
 * (with isPaused=true) so the caller can `return` directly.
 */
export async function dispatchCourierTransport(
  opts: DispatchCourierTransportOptions
): Promise<ProcessMessageResult> {
  const {
    repos,
    chatId,
    chat,
    character,
    characterParticipant,
    userParticipantId,
    isMultiCharacter,
    participantCharacters,
    resolvedIdentity,
    formattedMessages,
    streaming,
    controller,
    encoder,
  } = opts

  // Always render the full bundle. When delta mode applies (profile flag on
  // AND this character already has a checkpoint in this chat), we *also*
  // render a delta bundle and use it as the primary; the full bundle is
  // kept as a fallback the Salon bubble can switch to.
  const { markdown: fullMarkdown, attachments: fullAttachments } = renderCourierRequestAsMarkdown({
    messages: formattedMessages as unknown as LLMMessage[],
    characterName: character.name,
    modelLabel: streaming.effectiveProfile.modelName || undefined,
  })

  let deltaMarkdown: string | null = null
  let deltaAttachments: CourierAttachmentDescriptor[] = []
  let checkpointForLog: CourierCheckpoint | null = null
  const profileWantsDelta = streaming.effectiveProfile.courierDeltaMode !== false
  if (profileWantsDelta) {
    const checkpointMap = (chat.courierCheckpoints as Record<string, CourierCheckpoint> | null | undefined) ?? null
    const checkpoint = checkpointMap?.[character.id] ?? null
    if (checkpoint && checkpoint.resolvedAt) {
      checkpointForLog = checkpoint
      const deltaEvents = await buildCourierDeltaEvents({
        repos,
        chatId,
        checkpoint,
        chat,
        participantCharacters,
        respondingCharacter: character,
        respondingParticipantId: characterParticipant.id,
        resolvedIdentityName: resolvedIdentity.name,
      })
      const rendered = renderCourierDeltaAsMarkdown({
        events: deltaEvents,
        characterName: character.name,
        modelLabel: streaming.effectiveProfile.modelName || undefined,
      })
      deltaMarkdown = rendered.markdown
      deltaAttachments = rendered.attachments
    }
  }

  // Primary bundle = delta when applicable, else full. Attachments surface
  // the union (the bubble may swap between bundles so the user needs every
  // referenced file available).
  const primaryMarkdown = deltaMarkdown ?? fullMarkdown
  const fullFallback = deltaMarkdown ? fullMarkdown : null
  const unionAttachments: CourierAttachmentDescriptor[] = [...fullAttachments]
  for (const a of deltaAttachments) {
    if (!unionAttachments.some((x) => x.fileId === a.fileId)) {
      unionAttachments.push(a)
    }
  }

  const placeholderId = crypto.randomUUID()
  const nowIso = new Date().toISOString()
  const placeholderMessage = {
    id: placeholderId,
    type: 'message' as const,
    role: 'ASSISTANT' as const,
    content: '',
    createdAt: nowIso,
    attachments: [] as string[],
    participantId: characterParticipant.id,
    provider: streaming.effectiveProfile.provider || null,
    modelName: streaming.effectiveProfile.modelName || null,
    pendingExternalPrompt: primaryMarkdown,
    pendingExternalPromptFull: fullFallback,
    pendingExternalAttachments: unionAttachments,
  }

  await repos.chats.addMessage(chatId, placeholderMessage)
  await repos.chats.update(chatId, { isPaused: true, updatedAt: nowIso })

  safeEnqueue(controller, encodePendingExternalTurnEvent(encoder, {
    messageId: placeholderId,
    participantId: characterParticipant.id,
    characterName: character.name,
  }))

  safeEnqueue(controller, encodeDoneEvent(encoder, {
    messageId: placeholderId,
    participantId: characterParticipant.id,
    usage: null,
    cacheUsage: null,
    attachmentResults: null,
    toolsExecuted: false,
    provider: streaming.effectiveProfile.provider,
    modelName: streaming.effectiveProfile.modelName,
    pendingExternalTurn: true,
  }))

  logger.info('Courier transport: rendered request and parked placeholder', {
    chatId,
    messageId: placeholderId,
    characterName: character.name,
    attachmentCount: unionAttachments.length,
    promptLength: primaryMarkdown.length,
    deltaMode: !!deltaMarkdown,
    checkpoint: checkpointForLog?.lastResolvedMessageId ?? null,
  })

  return {
    isMultiCharacter,
    hasContent: false,
    messageId: placeholderId,
    userParticipantId,
    isPaused: true,
  }
}

interface BuildCourierDeltaEventsInput {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  checkpoint: CourierCheckpoint
  chat: ChatMetadataBase
  participantCharacters: Map<string, Character>
  respondingCharacter: Character
  /** Participant ID of the responding character — used to filter targeted
   * whispers so the delta only carries messages this character would
   * normally see (its own, public, or addressed to it). */
  respondingParticipantId: string
  resolvedIdentityName: string
}

/**
 * Walk the chat's persisted message events from after the checkpoint
 * timestamp, resolve each one's speaker for human display, look up file
 * attachments, and hand back a chronological list of {@link CourierDeltaEvent}s
 * for the renderer. The responding character's own resolved Courier turns
 * are excluded (the desktop LLM client produced them itself); other
 * characters' turns, user messages, tool results, and Staff whispers are
 * all included.
 */
async function buildCourierDeltaEvents(
  input: BuildCourierDeltaEventsInput,
): Promise<CourierDeltaEvent[]> {
  const { repos, chatId, checkpoint, chat, participantCharacters, respondingCharacter, respondingParticipantId, resolvedIdentityName } = input

  // Re-fetch messages so we pick up the user-message + tool-results that
  // were saved earlier in processMessage but never pushed into the
  // existingMessages snapshot.
  const freshMessages = await repos.chats.getMessages(chatId)

  // Speaker lookup helpers
  const participantToCharacter = new Map<string, Character>()
  for (const p of chat.participants) {
    if (p.characterId) {
      const c = participantCharacters.get(p.characterId)
      if (c) participantToCharacter.set(p.id, c)
    }
  }
  // Make sure the responding character is reachable even when the
  // participant map didn't load them (single-character chats skip the
  // bulk loader).
  for (const p of chat.participants) {
    if (p.characterId === respondingCharacter.id) {
      participantToCharacter.set(p.id, respondingCharacter)
    }
  }

  const resolveSpeaker = (event: { role?: string | null; participantId?: string | null; systemSender?: string | null; customAnnouncer?: { kind: 'character' | 'custom'; characterId?: string | null; displayName?: string | null } | null }): string => {
    if (event.systemSender) {
      return `[Staff: ${COURIER_SYSTEM_SENDER_LABELS[event.systemSender] ?? event.systemSender}]`
    }
    if (event.customAnnouncer) {
      if (event.customAnnouncer.kind === 'character' && event.customAnnouncer.characterId) {
        // The off-scene character may not be a participant; fall back to a generic
        // "Off-scene character" label if we cannot resolve a name from the chat.
        return event.customAnnouncer.displayName || 'Off-scene character'
      }
      if (event.customAnnouncer.kind === 'custom' && event.customAnnouncer.displayName) {
        return event.customAnnouncer.displayName
      }
    }
    if (event.role === 'USER') {
      if (event.participantId) {
        const c = participantToCharacter.get(event.participantId)
        if (c) return c.name
      }
      return resolvedIdentityName || 'User'
    }
    if (event.role === 'TOOL') {
      return 'Tool result'
    }
    if (event.role === 'ASSISTANT') {
      if (event.participantId) {
        const c = participantToCharacter.get(event.participantId)
        if (c) return c.name
      }
      return 'Assistant'
    }
    return event.role ?? 'Event'
  }

  const deltaEvents: CourierDeltaEvent[] = []
  for (const event of freshMessages) {
    if (event.type !== 'message') continue
    // Skip anything at-or-before the checkpoint.
    if ((event.createdAt as string) <= checkpoint.resolvedAt) continue
    // Skip the resolved Courier turn itself (defensive — its createdAt is
    // before resolvedAt by construction, but the guard makes the intent
    // obvious).
    if (event.id === checkpoint.lastResolvedMessageId) continue

    // Filter targeted whispers the same way `filterWhisperMessages` does for
    // the normal API context. Without this, every other character's
    // Commonplace Book recall / Aurora outfit / Librarian summary whisper
    // would leak into the responding character's delta — they were never
    // meant to see those.
    const targetIds = (event.targetParticipantIds as string[] | null | undefined) ?? null
    if (targetIds && targetIds.length > 0) {
      const isSender = event.participantId === respondingParticipantId
      const isTarget = targetIds.includes(respondingParticipantId)
      if (!isSender && !isTarget) continue
    }

    // Look up attachment descriptors. Files referenced by ID are fetched
    // through the standard files repo; missing files are skipped (with
    // the same "we already logged this" pattern other call sites use).
    const attachments: CourierAttachmentDescriptor[] = []
    const attachmentIds = (event.attachments as string[] | undefined) ?? []
    for (const fileId of attachmentIds) {
      try {
        const file = await repos.files.findById(fileId)
        if (!file) continue
        attachments.push({
          fileId: file.id,
          filename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: file.size,
          downloadUrl: `/api/v1/files/${file.id}`,
        })
      } catch (err) {
        logger.warn('Courier delta: could not load attachment metadata', {
          chatId,
          fileId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    deltaEvents.push({
      speaker: resolveSpeaker(event),
      createdAt: event.createdAt as string,
      content: event.content ?? '',
      attachments: attachments.length > 0 ? attachments : undefined,
    })
  }

  return deltaEvents
}
