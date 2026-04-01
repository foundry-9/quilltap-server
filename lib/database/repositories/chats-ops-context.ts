/**
 * Chats Ops Context
 *
 * Shared dependency injection contract for chat operations modules.
 * Provides access to repository methods without creating circular dependencies.
 */

import { ChatMetadata } from '@/lib/schemas/types';
import { DatabaseCollection } from '../interfaces';

/**
 * Context interface that ops classes receive in their constructor.
 * Bound methods from ChatsRepository that ops modules need.
 */
export interface ChatOpsContext {
  findById(id: string): Promise<ChatMetadata | null>;
  update(id: string, data: Partial<ChatMetadata>): Promise<ChatMetadata | null>;
  getCollection(): Promise<DatabaseCollection<ChatMetadata>>;
  getMessagesCollection(): Promise<DatabaseCollection>;
  isSQLiteBackend(): boolean;
  generateId(): string;
  getCurrentTimestamp(): string;
}
