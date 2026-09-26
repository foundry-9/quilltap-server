/**
 * Render a stored chat to Scriptorium Markdown, on demand.
 *
 * The rendered transcript used to be persisted on the chat row
 * (`chats.renderedMarkdown`). It is deterministic — a pure function of the
 * chat's messages, participants and header metadata — so storing it only bought
 * a second copy of the transcript (about 160 KB per chat) that every whole-row
 * chat read then had to carry, and that the stale-chat sweep then had to throw
 * away. Everything that needs the Markdown now calls this instead:
 *
 *  - the CONVERSATION_RENDER job, which only keeps the interchange chunks;
 *  - `read_conversation`, which hands the transcript to a character;
 *  - `upsert_conversation_annotation`, which validates a message index.
 *
 * Speaker names come from `resolveSpeakerNames`, the one place a participantId
 * becomes a display name — raw reads, so a character whose vault is broken
 * costs a label rather than the whole render.
 *
 * Read-only: safe in the parent and in the job child.
 *
 * @module scriptorium/render-chat
 */

import { getRepositories } from '@/lib/repositories/factory';
import { resolveSpeakerNames } from '@/lib/chat/speaker-names';
import { createServiceLogger } from '@/lib/logging/create-logger';
import type { ChatMetadata } from '@/lib/schemas/types';
import type { RenderedConversation } from '@/lib/schemas/scriptorium.types';
import { renderConversationMarkdown } from './markdown-renderer';

const logger = createServiceLogger('Scriptorium:RenderChat');

/**
 * Render `chat` from its stored messages. Returns `null` when the chat has no
 * events at all; a chat with events but no visible dialogue renders to a
 * header and zero interchanges.
 */
export async function renderChatConversation(
  chat: Pick<ChatMetadata, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'participants'>,
): Promise<RenderedConversation | null> {
  const repos = getRepositories();
  const startTime = Date.now();

  const events = await repos.chats.getMessages(chat.id);
  if (events.length === 0) {
    logger.debug('No events to render', { chatId: chat.id });
    return null;
  }

  const speakerNames = await resolveSpeakerNames(chat);

  const result = renderConversationMarkdown(events, chat.participants, speakerNames, {
    conversationId: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    lastUpdatedAt: chat.updatedAt,
  });

  logger.debug('Rendered conversation', {
    chatId: chat.id,
    events: events.length,
    interchanges: result.interchanges.length,
    markdownLength: result.markdown.length,
    durationMs: Date.now() - startTime,
  });

  return result;
}
