/**
 * Brahma Console — getting attachments to the model.
 *
 * Every operator message that carries attachments has them loaded through the
 * Salon's own path (`loadChatFilesForLLM` → `prepareTurnAttachments`): images
 * tagged — this turn's as uploads, earlier turns' as re-hydrated — and handed
 * on whole for `applyImageTransportBudget` to send, describe or omit on the
 * final array; text and documents inlined or kept by the native-transport
 * rule. Nothing here checks capability, counts or bytes.
 *
 * Each such message also gains one model-facing line per attachment,
 * `[Attached: qtap://Quilltap General/Brahma/<file>]`, so the model can open
 * the file with its document tools. The line is built per request and never
 * stored; it is carried on every turn (not only the current one) so the
 * history — and the prompt-cache prefix — stays the same from turn to turn.
 *
 * @module lib/services/brahma-console/turn-attachments
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { loadChatFilesForLLM } from '@/lib/chat-files-v2'
import { prepareTurnAttachments } from '@/lib/services/chat-message/context-builder.service'
import { consoleAttachmentUri } from '@/lib/brahma-console/attachments'
import { getErrorMessage } from '@/lib/error-utils'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { getRepositories } from '@/lib/repositories/factory'

const logger = createServiceLogger('BrahmaConsoleTurnAttachments')

/** What one operator message carries to the model. */
export interface MessageAttachmentPayload {
  /** Loaded attachments (images tagged) to ride on the message. */
  attachments: unknown[]
  /** Text to put before the message's own words (inlined files). */
  prefix: string
  /** `[Attached: …]` lines to put after the message's own words. */
  addressLines: string[]
}

/**
 * Load the attachments of every operator message that has any.
 * `currentMessageId` is this turn's message (its images are uploads).
 * Never throws: an unreadable file is left out with a `warn`.
 */
export async function loadConsoleTurnAttachments(args: {
  messages: ReadonlyArray<{ id?: string; type?: string; role?: string; attachments?: string[] | null; createdAt?: string }>
  currentMessageId: string
  connectionProfile: ConnectionProfile
  repos: ReturnType<typeof getRepositories>
  userId: string
  chatId: string
}): Promise<Map<string, MessageAttachmentPayload>> {
  const out = new Map<string, MessageAttachmentPayload>()

  for (const m of args.messages) {
    if (m.type !== 'message' || m.role !== 'USER' || !m.id) continue
    const ids = (m.attachments ?? []).filter((id): id is string => typeof id === 'string')
    if (ids.length === 0) continue

    try {
      const loaded = await loadChatFilesForLLM(ids, { provider: args.connectionProfile.provider })
      const isCurrent = m.id === args.currentMessageId
      const { attachmentsToSend, messageContentPrefix } = await prepareTurnAttachments(loaded, {
        connectionProfile: args.connectionProfile,
        repos: args.repos,
        userId: args.userId,
        chatId: args.chatId,
        origin: isCurrent ? 'upload' : 'rehydrated',
        uploadedAt: m.createdAt ? Date.parse(m.createdAt) || Date.now() : Date.now(),
      })

      const addressLines: string[] = []
      const links = await args.repos.docMountFileLinks.findByIdsWithContent(ids)
      for (const id of ids) {
        const link = links.find(l => l.id === id)
        if (!link) continue
        const uri = await consoleAttachmentUri(link)
        if (uri) addressLines.push(`[Attached: ${uri}]`)
      }

      out.set(m.id, { attachments: attachmentsToSend, prefix: messageContentPrefix, addressLines })
      logger.debug('Loaded Console message attachments', {
        chatId: args.chatId,
        messageId: m.id,
        requested: ids.length,
        loaded: loaded.length,
        sent: attachmentsToSend.length,
        inlinedChars: messageContentPrefix.length,
        current: isCurrent,
      })
    } catch (error) {
      logger.warn('Could not load a Console message\'s attachments; sending its words alone', {
        chatId: args.chatId,
        messageId: m.id,
        error: getErrorMessage(error),
      })
    }
  }

  return out
}

/** A message's content with its inlined files before and its addresses after. */
export function composeAttachmentContent(content: string, payload: MessageAttachmentPayload | undefined): string {
  if (!payload) return content
  const parts: string[] = []
  if (payload.prefix) parts.push(payload.prefix.trimEnd())
  if (content.trim()) parts.push(content)
  if (payload.addressLines.length > 0) parts.push(payload.addressLines.join('\n'))
  return parts.join('\n\n')
}
