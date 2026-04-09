/**
 * Cascade Delete Utilities
 *
 * Helper functions to find related entities that should be deleted
 * when a character (or other entity) is deleted.
 */

import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/repositories/factory'
import { fileStorageManager } from '@/lib/file-storage/manager'
import { getVectorStoreManager } from '@/lib/embedding/vector-store'
import type { ChatMetadata, FileEntry } from '@/lib/schemas/types'

/**
 * Delete a file's bytes from storage and metadata from repository
 */
async function deleteFileCompletely(fileId: string): Promise<boolean> {
  const repos = getRepositories()
  const entry = await repos.files.findById(fileId)

  if (!entry) {

    return false
  }

  // Delete the file bytes from storage
  if (entry.storageKey) {
    try {
      await fileStorageManager.deleteFile(entry)

    } catch (error) {
      logger.error('Failed to delete file from storage', { fileId, storageKey: entry.storageKey }, error instanceof Error ? error : undefined)
    }
  } else {
    logger.warn('File has no storage key, cannot delete bytes', { fileId })
  }

  // Delete metadata from repository
  const deleted = await repos.files.delete(fileId)

  return deleted
}

export interface ExclusiveChatInfo {
  chat: ChatMetadata
  messageCount: number
}

export interface CascadeDeletePreview {
  characterId: string
  characterName: string
  exclusiveChats: ExclusiveChatInfo[]
  exclusiveCharacterImages: FileEntry[]
  exclusiveChatImages: FileEntry[]
  memoryCount: number
}

/**
 * Find chats that are exclusively associated with a character.
 * "Exclusive" means the chat only has this one character as a CHARACTER participant.
 * Chats with multiple characters are not considered exclusive.
 */
export async function findExclusiveChatsForCharacter(
  characterId: string
): Promise<ExclusiveChatInfo[]> {
  const repos = getRepositories()

  // Get all chats that include this character
  const chatsWithCharacter = await repos.chats.findByCharacterId(characterId)

  const exclusiveChats: ExclusiveChatInfo[] = []

  for (const chat of chatsWithCharacter) {
    // Get all AI-controlled CHARACTER participants in this chat
    // User-controlled participants (controlledBy === 'user') are excluded from exclusivity checks
    // since they represent the user's own character and don't affect whether a chat is "exclusive" to an AI character
    const characterParticipants = chat.participants.filter(
      p => p.type === 'CHARACTER' && p.controlledBy !== 'user'
    )

    // If this is the only AI character in the chat, it's exclusive
    if (characterParticipants.length === 1 && characterParticipants[0].characterId === characterId) {
      exclusiveChats.push({
        chat,
        messageCount: chat.messageCount || 0,
      })
    }
  }

  return exclusiveChats
}

/**
 * Find images that are exclusively associated with a character.
 * "Exclusive" means the image is only linked to this character and nothing else.
 * Uses batched queries to avoid N+1 patterns.
 */
export async function findExclusiveImagesForCharacter(
  characterId: string
): Promise<FileEntry[]> {
  const repos = getRepositories()
  const character = await repos.characters.findById(characterId)

  if (!character) {
    return []
  }

  const exclusiveImages: FileEntry[] = []

  // Check defaultImageId
  if (character.defaultImageId) {
    const image = await repos.files.findById(character.defaultImageId)
    if (image) {
      // Check if this image is only linked to this character
      const isExclusive = image.linkedTo.length === 0 ||
        (image.linkedTo.length === 1 && image.linkedTo[0] === characterId)

      if (isExclusive) {
        // Use targeted queries to check if used as default image elsewhere
        const charsUsingAsDefault = await repos.characters.findByDefaultImageId(image.id)

        const usedElsewhere = charsUsingAsDefault.some(c => c.id !== characterId)

        if (!usedElsewhere) {
          exclusiveImages.push(image)
        }
      }
    }
  }

  // Collect all avatar override image IDs and fetch in batch
  const overrideImageIds = (character.avatarOverrides || [])
    .map(o => o.imageId)
    .filter((id): id is string => !!id)

  if (overrideImageIds.length > 0) {
    const overrideImages = await repos.files.findByIds(overrideImageIds)

    for (const image of overrideImages) {
      // Skip if already added
      if (exclusiveImages.find(i => i.id === image.id)) {
        continue
      }

      // Use targeted queries to check usage
      const [charsUsingAsDefault, charsUsingInOverrides] = await Promise.all([
        repos.characters.findByDefaultImageId(image.id),
        repos.characters.findByAvatarOverrideImageId(image.id),
      ])

      const usedElsewhere =
        charsUsingAsDefault.some(c => c.id !== characterId) ||
        charsUsingInOverrides.some(c => c.id !== characterId)

      if (!usedElsewhere) {
        exclusiveImages.push(image)
      }
    }
  }

  return exclusiveImages
}

/**
 * Find images that are exclusively associated with a set of chats.
 * These are images attached to messages in those chats that aren't used elsewhere.
 * Uses batched and targeted queries to avoid N+1 patterns.
 */
export async function findExclusiveImagesForChats(
  chatIds: string[]
): Promise<FileEntry[]> {
  if (chatIds.length === 0) {
    return []
  }

  const repos = getRepositories()
  const exclusiveImages: FileEntry[] = []
  const chatIdSet = new Set(chatIds)

  // Collect all image IDs from messages in these chats
  const imageIdsInChats = new Set<string>()

  for (const chatId of chatIds) {
    const messages = await repos.chats.getMessages(chatId)
    for (const message of messages) {
      if (message.type === 'message' && message.attachments) {
        for (const attachmentId of message.attachments) {
          imageIdsInChats.add(attachmentId)
        }
      }
    }
  }

  if (imageIdsInChats.size === 0) {
    return []
  }

  // Fetch all images in batch
  const images = await repos.files.findByIds(Array.from(imageIdsInChats))

  for (const image of images) {
    // Check if image is linked to other entities (not being deleted)
    const linkedToOthers = image.linkedTo.some(entityId => !chatIdSet.has(entityId))
    if (linkedToOthers) {
      continue
    }

    // Use targeted queries to check if used as character default or override
    const [charsUsingAsDefault, charsUsingInOverrides] = await Promise.all([
      repos.characters.findByDefaultImageId(image.id),
      repos.characters.findByAvatarOverrideImageId(image.id),
    ])

    const usedByCharacter =
      charsUsingAsDefault.length > 0 ||
      charsUsingInOverrides.length > 0

    if (!usedByCharacter) {
      exclusiveImages.push(image)
    }
  }

  return exclusiveImages
}

/**
 * Get a full preview of what will be deleted if a character is deleted with cascade.
 */
export async function getCascadeDeletePreview(
  characterId: string
): Promise<CascadeDeletePreview | null> {
  const repos = getRepositories()
  const character = await repos.characters.findById(characterId)

  if (!character) {
    return null
  }

  const exclusiveChats = await findExclusiveChatsForCharacter(characterId)
  const exclusiveCharacterImages = await findExclusiveImagesForCharacter(characterId)
  const exclusiveChatImages = await findExclusiveImagesForChats(
    exclusiveChats.map(c => c.chat.id)
  )

  // Get memory count for this character
  const memoryCount = await repos.memories.countByCharacterId(characterId)

  return {
    characterId,
    characterName: character.name,
    exclusiveChats,
    exclusiveCharacterImages,
    exclusiveChatImages,
    memoryCount,
  }
}

/**
 * Execute cascade deletion for a character.
 * Deletes the character along with its memories, and optionally deletes exclusive chats and images.
 */
export async function executeCascadeDelete(
  characterId: string,
  options: {
    deleteExclusiveChats: boolean
    deleteExclusiveImages: boolean
  }
): Promise<{
  success: boolean
  deletedChats: number
  deletedImages: number
  deletedMemories: number
}> {
  const repos = getRepositories()
  const character = await repos.characters.findById(characterId)

  if (!character) {
    return { success: false, deletedChats: 0, deletedImages: 0, deletedMemories: 0 }
  }

  let deletedChats = 0
  let deletedImages = 0
  let deletedMemories = 0

  // Get preview to know what to delete
  const preview = await getCascadeDeletePreview(characterId)
  if (!preview) {
    return { success: false, deletedChats: 0, deletedImages: 0, deletedMemories: 0 }
  }

  // Delete exclusive chats if requested
  if (options.deleteExclusiveChats) {
    // First delete exclusive chat images if requested
    if (options.deleteExclusiveImages) {
      for (const image of preview.exclusiveChatImages) {
        try {
          await deleteFileCompletely(image.id)
          deletedImages++
        } catch (err) {
          logger.error(`Failed to delete chat image ${image.id}`, { context: { imageId: image.id } }, err instanceof Error ? err : undefined)
        }
      }
    }

    // Then delete the chats
    for (const { chat } of preview.exclusiveChats) {
      try {
        await repos.chats.delete(chat.id)
        deletedChats++
      } catch (err) {
        logger.error(`Failed to delete chat ${chat.id}`, { context: { chatId: chat.id } }, err instanceof Error ? err : undefined)
      }
    }
  }

  // Delete exclusive character images if requested
  if (options.deleteExclusiveImages) {
    for (const image of preview.exclusiveCharacterImages) {
      try {
        await deleteFileCompletely(image.id)
        deletedImages++
      } catch (err) {
        logger.error(`Failed to delete character image ${image.id}`, { context: { imageId: image.id } }, err instanceof Error ? err : undefined)
      }
    }
  }

  // Always delete memories associated with the character
  if (preview.memoryCount > 0) {
    try {
      const memories = await repos.memories.findByCharacterId(characterId)
      const memoryIds = memories.map(m => m.id)
      deletedMemories = await repos.memories.bulkDelete(characterId, memoryIds)
    } catch (err) {
      logger.error(`Failed to delete memories for character ${characterId}`, { context: { characterId } }, err instanceof Error ? err : undefined)
    }
  }

  // Delete the character's vector index (embeddings)
  try {
    const vectorStoreManager = getVectorStoreManager()
    await vectorStoreManager.deleteStore(characterId)
  } catch (err) {
    logger.error(`Failed to delete vector store for character ${characterId}`, { context: { characterId } }, err instanceof Error ? err : undefined)
  }

  // Finally delete the character
  await repos.characters.delete(characterId)

  return { success: true, deletedChats, deletedImages, deletedMemories }
}
