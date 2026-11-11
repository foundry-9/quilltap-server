/**
 * Open a chat that was never opened, ahead of an ordinary send.
 *
 * Casting (`POST /api/v1/chats`) leaves the row `'pending'`; the Salon opens it
 * on mount, and API clients call `?action=open`. A client that casts and then
 * sends without opening — or a send that beats the Salon's mount — would run
 * its first turn with nobody dressed, nothing packed and no staff briefing,
 * and the opening would then post all of that after the conversation (#185).
 * The send path calls this first: the opening runs on the send's stream,
 * without the greeting, since the operator's line is the first one.
 *
 * @module services/chat-message/open-before-send
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { runOpening } from '@/lib/chat/opening/run'
import type { GreenRoomNarrator } from '@/lib/chat/opening/narrator'
import type { RepositoryContainer } from '@/lib/repositories/factory'

const logger = createServiceLogger('OpenBeforeSend')

/**
 * Run a not-yet-opened chat's opening, without the greeting. A chat already
 * opened (the common case) costs one read. An autonomous room is left alone:
 * it opens through its run start, and opening it here would start it as an
 * ad-hoc room.
 */
export async function openBeforeSend(
  repos: RepositoryContainer,
  chatId: string,
  userId: string,
  narrator: GreenRoomNarrator,
): Promise<void> {
  const { state } = await repos.chats.getOpeningState(chatId)
  if (state === 'done') return
  const chat = await repos.chats.findById(chatId)
  if (!chat) return
  if (chat.chatType === 'autonomous') {
    logger.debug('Send to an unopened autonomous room; its run start opens it', { chatId, state })
    return
  }
  logger.info('Send to a chat not yet opened; opening it first, without a greeting', { chatId, state })
  await runOpening({ repos, chatId, userId, trigger: 'open', narrator })
}
