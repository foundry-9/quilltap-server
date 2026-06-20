/**
 * Shared helpers for the MessageRow subcomponents.
 */

import type { Message } from '../../types'

/** The message's image attachments (filtered by image/* MIME type). */
export function getImageAttachments(message: Message) {
  return (message.attachments || []).filter(a => a.mimeType.startsWith('image/'))
}
