/**
 * Get File Associations
 *
 * Helper function to resolve file association details, including which characters
 * use the file as a default or override image, and which messages have attachments
 * linking to the file.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { UserScopedRepositoryContainer } from '@/lib/repositories/user-scoped';

export interface FileAssociation {
  characters: { id: string; name: string; usage: 'default' | 'override' }[];
  messages: { chatId: string; chatName: string; messageId: string }[];
}

/**
 * Get all associations for a file (characters using it, messages referencing it)
 *
 * @param fileId - The file ID to look up associations for
 * @param linkedTo - Array of entity IDs that reference this file
 * @param repos - User-scoped repositories for database access
 * @returns FileAssociation object with characters and messages arrays
 *
 * @example
 * ```typescript
 * const associations = await getFileAssociations(fileId, file.linkedTo, repos);
 * console.log(associations.characters); // [{ id, name, usage }...]
 * console.log(associations.messages); // [{ chatId, chatName, messageId }...]
 * ```
 */
export async function getFileAssociations(
  fileId: string,
  linkedTo: string[],
  repos: UserScopedRepositoryContainer
): Promise<FileAssociation> {
  // Log the start of the operation
  logger.debug('Starting file association lookup', {
    context: 'getFileAssociations',
    fileId,
    linkedToCount: linkedTo.length,
  });

  const result: FileAssociation = {
    characters: [],
    messages: [],
  };

  // Get base repositories for accessing character queries
  const baseRepos = getRepositories();

  // Query characters using this file as default image
  const allDefaultImageCharacters = await baseRepos.characters.findByDefaultImageId(fileId);
  // Filter to user's characters only
  const defaultImageCharacters = allDefaultImageCharacters.filter(char => char.userId === repos.userId);
  const defaultCharacterCount = defaultImageCharacters.length;
  logger.debug('Found characters with default image', {
    context: 'getFileAssociations',
    fileId,
    count: defaultCharacterCount,
  });

  // Query characters using this file in avatar overrides
  const allOverrideImageCharacters = await baseRepos.characters.findByAvatarOverrideImageId(fileId);
  // Filter to user's characters only
  const overrideImageCharacters = allOverrideImageCharacters.filter(char => char.userId === repos.userId);
  const overrideCharacterCount = overrideImageCharacters.length;
  logger.debug('Found characters with avatar override image', {
    context: 'getFileAssociations',
    fileId,
    count: overrideCharacterCount,
  });

  // Build a map to deduplicate characters by ID
  const characterMap = new Map<string, { id: string; name: string; usage: 'default' | 'override' }>();

  // Add default image characters
  for (const char of defaultImageCharacters) {
    characterMap.set(char.id, {
      id: char.id,
      name: char.name,
      usage: 'default',
    });
  }

  // Add override image characters (update usage if already present)
  for (const char of overrideImageCharacters) {
    if (characterMap.has(char.id)) {
      // Character appears in both - keep default as primary usage
      // or could mark as both, but spec says deduplicate by id
      const existing = characterMap.get(char.id)!;
      characterMap.set(char.id, {
        ...existing,
        usage: existing.usage === 'default' ? 'default' : 'override',
      });
    } else {
      characterMap.set(char.id, {
        id: char.id,
        name: char.name,
        usage: 'override',
      });
    }
  }

  result.characters = Array.from(characterMap.values());
  logger.debug('Deduplicated character associations', {
    context: 'getFileAssociations',
    fileId,
    uniqueCount: result.characters.length,
  });

  // For each ID in linkedTo, check if it's a message in any chat
  logger.debug('Starting message association lookup', {
    context: 'getFileAssociations',
    fileId,
    linkedToCount: linkedTo.length,
  });

  // Get all user's chats
  const chats = await repos.chats.findAll();
  logger.debug('Retrieved user chats', {
    context: 'getFileAssociations',
    fileId,
    chatCount: chats.length,
  });

  // For each chat, get messages and check for matching attachments
  // linkedTo can contain either chatId or messageId, so we check both:
  // 1. If chatId is in linkedTo, check all messages in that chat for this file
  // 2. If messageId is in linkedTo, check if that message has this file
  for (const chat of chats) {
    try {
      const chatInLinkedTo = linkedTo.includes(chat.id);
      const messages = await repos.chats.getMessages(chat.id);
      logger.debug('Retrieved chat messages', {
        context: 'getFileAssociations',
        fileId,
        chatId: chat.id,
        messageCount: messages.length,
        chatInLinkedTo,
      });

      // Check each message for file attachment
      for (const message of messages) {
        // Only process actual messages (not system events)
        if (message.type !== 'message') {
          continue;
        }

        // Check if the file is in the message's attachments
        if (message.attachments?.includes(fileId)) {
          // Match if: chatId is in linkedTo OR messageId is in linkedTo
          if (chatInLinkedTo || linkedTo.includes(message.id)) {
            result.messages.push({
              chatId: chat.id,
              chatName: chat.title,
              messageId: message.id,
            });
            logger.debug('Found message with file attachment', {
              context: 'getFileAssociations',
              fileId,
              messageId: message.id,
              chatId: chat.id,
              matchedBy: chatInLinkedTo ? 'chatId' : 'messageId',
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Error processing messages for chat', {
        context: 'getFileAssociations',
        fileId,
        chatId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.debug('Completed file association lookup', {
    context: 'getFileAssociations',
    fileId,
    characterCount: result.characters.length,
    messageCount: result.messages.length,
  });

  return result;
}
