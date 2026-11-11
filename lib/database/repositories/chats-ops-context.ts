/**
 * Chats Ops Context
 *
 * Shared dependency injection contract for chat operations modules.
 * Provides access to repository methods without creating circular dependencies.
 */

import { ChatEvent, ChatMetadata } from '@/lib/schemas/types';
import { DatabaseCollection } from '../interfaces';

/**
 * One row of the `chat_messages` table on the SQLite backend: a chat event
 * flattened into its own row, keyed back to its chat by `chatId`.
 */
export type ChatMessageRow = ChatEvent & { chatId: string };

/**
 * The legacy (non-SQLite) shape of the messages collection: one document per
 * chat holding the whole transcript as an embedded array.
 */
export interface LegacyChatMessagesDoc {
  chatId: string;
  messages: ChatEvent[];
  createdAt?: string;
  updatedAt: string;
}

/** Either shape the messages collection can hold, by backend. */
export type ChatMessagesCollectionDoc = ChatMessageRow | LegacyChatMessagesDoc;

/**
 * Context interface that ops classes receive in their constructor.
 * Bound methods from ChatsRepository that ops modules need.
 */
export interface ChatOpsContext {
  findById(id: string): Promise<ChatMetadata | null>;
  update(id: string, data: Partial<ChatMetadata>): Promise<ChatMetadata | null>;
  getCollection(): Promise<DatabaseCollection<ChatMetadata>>;
  /**
   * The messages collection, typed by the caller for the backend it is on:
   * {@link ChatMessageRow} (the default) on SQLite, {@link LegacyChatMessagesDoc}
   * on the legacy embedded-array backend.
   */
  getMessagesCollection<
    TDoc extends ChatMessagesCollectionDoc = ChatMessageRow,
  >(): Promise<DatabaseCollection<TDoc>>;
  isSQLiteBackend(): boolean;
  generateId(): string;
  getCurrentTimestamp(): string;
}
