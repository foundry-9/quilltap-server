/**
 * Chats API v1 - Types
 *
 * Type definitions for chat route handlers
 */

import type { MessagePair } from '@/lib/background-jobs';

/**
 * Extended message pair with character info for multi-character support
 */
export interface MessagePairWithCharacter extends MessagePair {
  characterId: string;
  characterName: string;
}
