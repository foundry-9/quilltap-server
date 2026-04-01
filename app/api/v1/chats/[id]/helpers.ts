/**
 * Chats API v1 - Helper Functions
 *
 * Shared helper functions for chat route handlers
 */

import { z } from 'zod';
import { enrichWithDefaultImage, enrichWithApiKey } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import type { ChatMetadata, ChatParticipantBase } from '@/lib/schemas/types';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import {
  updateParticipantSchema,
  addParticipantSchema,
  chatUpdateRequestSchema,
} from './schemas';

type Repos = RepositoryContainer;

/**
 * Get enriched character data with default image
 */
export async function getEnrichedCharacter(characterId: string, repos: Repos) {
  const charData = await repos.characters.findById(characterId);
  if (!charData) return null;

  const defaultImage = await enrichWithDefaultImage(charData.defaultImageId, repos);

  return {
    id: charData.id,
    name: charData.name,
    title: charData.title,
    avatarUrl: charData.avatarUrl,
    talkativeness: charData.talkativeness ?? 0.5,
    defaultImageId: charData.defaultImageId,
    defaultImage,
    defaultConnectionProfileId: charData.defaultConnectionProfileId,
  };
}

/**
 * Get enriched connection profile with API key info
 */
export async function getEnrichedConnectionProfile(profileId: string, repos: Repos) {
  const profile = await repos.connections.findById(profileId);
  if (!profile) return null;

  const apiKeyInfo = await enrichWithApiKey(profile.apiKeyId, repos);

  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    apiKey: apiKeyInfo,
  };
}

/**
 * Enrich a participant with character and connection profile details
 */
export async function enrichParticipant(participant: ChatParticipantBase, repos: Repos) {
  if (participant.type !== 'CHARACTER') {
    throw new Error('Only CHARACTER participants are supported');
  }

  const character = participant.characterId
    ? await getEnrichedCharacter(participant.characterId, repos)
    : null;

  const connectionProfile = participant.connectionProfileId
    ? await getEnrichedConnectionProfile(participant.connectionProfileId, repos)
    : null;

  return {
    id: participant.id,
    type: participant.type,
    controlledBy: participant.controlledBy || 'llm',
    characterId: participant.characterId,
    displayOrder: participant.displayOrder,
    isActive: participant.isActive,
    status: participant.status || 'active',
    removedAt: participant.removedAt ?? null,
    hasHistoryAccess: participant.hasHistoryAccess,
    joinScenario: participant.joinScenario,
    character,
    connectionProfile,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
  };
}

/**
 * Handle participant update with impersonation sync
 */
export async function handleParticipantUpdate(
  chatId: string,
  data: z.infer<typeof updateParticipantSchema>,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  const { participantId, ...participantData } = data;

  if (participantData.connectionProfileId) {
    const profile = await repos.connections.findById(participantData.connectionProfileId);
    if (!profile || profile.userId !== userId) {
      return { error: 'Connection profile not found', status: 404 };
    }
  }

  if (participantData.imageProfileId) {
    const profile = await repos.imageProfiles.findById(participantData.imageProfileId);
    if (!profile || profile.userId !== userId) {
      return { error: 'Image profile not found', status: 404 };
    }
  }

  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return { error: 'Chat not found', status: 404 };
  }

  const result = await repos.chats.updateParticipant(chatId, participantId, participantData);
  if (!result) {
    return { error: 'Participant not found', status: 404 };
  }

  if (participantData.controlledBy !== undefined) {
    const currentImpersonating = chat.impersonatingParticipantIds || [];
    const isCurrentlyImpersonating = currentImpersonating.includes(participantId);

    if (participantData.controlledBy === 'user' && !isCurrentlyImpersonating) {
      const newImpersonating = [...currentImpersonating, participantId];
      await repos.chats.update(chatId, {
        impersonatingParticipantIds: newImpersonating,
        ...(result.activeTypingParticipantId ? {} : { activeTypingParticipantId: participantId }),
      });
    } else if (participantData.controlledBy === 'llm' && isCurrentlyImpersonating) {
      const newImpersonating = currentImpersonating.filter((id) => id !== participantId);
      const updateData: Partial<ChatMetadata> = { impersonatingParticipantIds: newImpersonating };

      if (result.activeTypingParticipantId === participantId) {
        updateData.activeTypingParticipantId = newImpersonating[0] || null;
      }

      await repos.chats.update(chatId, updateData);
    }

    const updatedChat = await repos.chats.findById(chatId);
    if (updatedChat) {
      return { chat: updatedChat };
    }
  }

  // If status was explicitly set, sync isActive and record the change event
  if (participantData.status) {
    const participant = chat.participants.find(p => p.id === participantId);
    const oldStatus = participant?.status || (participant?.isActive ? 'active' : (participant?.removedAt ? 'removed' : 'absent'));
    const newStatus = participantData.status;

    const isActive = newStatus === 'active' || newStatus === 'silent';
    await repos.chats.updateParticipant(chatId, participantId, {
      isActive,
      removedAt: newStatus === 'removed' ? new Date().toISOString() : null,
    });

    // Record status change event so other characters are notified
    if (oldStatus !== newStatus && participant?.characterId) {
      const character = await repos.characters.findById(participant.characterId);
      if (character) {
        await recordStatusChangeEvent(chatId, character.name, oldStatus, newStatus, repos);
      }
    }
  }
  // Backward compat: if isActive was set without status, derive status
  if (participantData.isActive !== undefined && !participantData.status) {
    const participant = chat.participants.find(p => p.id === participantId);
    const oldIsActive = participant?.isActive;
    const newStatus = participantData.isActive ? 'active' : 'absent';
    await repos.chats.updateParticipant(chatId, participantId, { status: newStatus });

    // Record status change event
    if (oldIsActive !== participantData.isActive && participant?.characterId) {
      const oldStatus = oldIsActive ? 'active' : 'absent';
      const character = await repos.characters.findById(participant.characterId);
      if (character) {
        await recordStatusChangeEvent(chatId, character.name, oldStatus, newStatus, repos);
      }
    }
  }

  // Re-fetch to get the latest state after all updates
  const finalChat = await repos.chats.findById(chatId);
  return { chat: finalChat || result };
}

/**
 * Handle adding a new participant to a chat
 */
export async function handleAddParticipant(
  chatId: string,
  data: z.infer<typeof addParticipantSchema>,
  currentParticipantCount: number,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  if (!data.characterId) {
    return { error: 'characterId is required for CHARACTER participants', status: 400 };
  }

  const character = await repos.characters.findById(data.characterId);
  if (!character || character.userId !== userId) {
    return { error: 'Character not found', status: 404 };
  }

  const controlledBy = data.controlledBy || character.controlledBy || 'llm';
  const isUserControlled = controlledBy === 'user';

  if (!isUserControlled && !data.connectionProfileId) {
    return { error: 'connectionProfileId is required for LLM-controlled CHARACTER participants', status: 400 };
  }

  if (data.connectionProfileId) {
    const profile = await repos.connections.findById(data.connectionProfileId);
    if (!profile || profile.userId !== userId) {
      return { error: 'Connection profile not found', status: 404 };
    }
  }

  let result = await repos.chats.addParticipant(chatId, {
    type: 'CHARACTER',
    characterId: data.characterId,
    controlledBy: controlledBy,
    connectionProfileId: data.connectionProfileId || null,
    imageProfileId: data.imageProfileId || null,
    displayOrder: data.displayOrder ?? currentParticipantCount,
    isActive: true,
    status: 'active',
    hasHistoryAccess: data.hasHistoryAccess ?? false,
    joinScenario: data.joinScenario || null,
  });

  if (!result) {
    return { error: 'Failed to add participant', status: 500 };
  }

  if (character.tags && character.tags.length > 0) {
    const existingTagIds = new Set(result.tags || []);
    const newTags = character.tags.filter((tagId: string) => !existingTagIds.has(tagId));

    if (newTags.length > 0) {const mergedTags = [...(result.tags || []), ...newTags];
      const updatedChat = await repos.chats.update(chatId, { tags: mergedTags });
      if (updatedChat) {
        return { chat: updatedChat };
      }
    }
  }

  return { chat: result };
}

/**
 * Handle removing a participant from a chat
 */
export async function handleRemoveParticipant(
  chatId: string,
  participantId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  try {
    const result = await repos.chats.removeParticipant(chatId, participantId);
    if (!result) {
      return { error: 'Participant not found', status: 404 };
    }
    return { chat: result };
  } catch (error) {
    if (error instanceof Error && error.message.includes('last participant')) {
      return { error: 'Cannot remove the last participant from a chat', status: 400 };
    }
    throw error;
  }
}

/**
 * Process all chat updates from a request
 */
export async function processChatUpdates(
  chatId: string,
  existingChat: ChatMetadata,
  validatedData: z.infer<typeof chatUpdateRequestSchema>,
  userId: string,
  repos: Repos
): Promise<{ chat: ChatMetadata } | { error: string; status: number }> {
  let updatedChat = existingChat;

  if (typeof validatedData.roleplayTemplateId !== 'undefined') {
    if (validatedData.roleplayTemplateId !== null) {
      const template = await repos.roleplayTemplates.findById(validatedData.roleplayTemplateId);
      if (!template) {
        return { error: 'Roleplay template not found', status: 404 };
      }
    }

    const result = await repos.chats.update(chatId, {
      roleplayTemplateId: validatedData.roleplayTemplateId,
    });
    if (result) updatedChat = result;
  }

  // Handle imageProfileId shortcut (same as chat.imageProfileId)
  if (typeof validatedData.imageProfileId !== 'undefined') {
    if (validatedData.imageProfileId !== null) {
      const profile = await repos.imageProfiles.findById(validatedData.imageProfileId);
      if (!profile || profile.userId !== userId) {
        return { error: 'Image profile not found', status: 404 };
      }
    }

    const result = await repos.chats.update(chatId, {
      imageProfileId: validatedData.imageProfileId,
    });
    if (result) updatedChat = result;
  }

  if (validatedData.chat) {
    if (validatedData.chat.roleplayTemplateId !== undefined && validatedData.chat.roleplayTemplateId !== null) {
      const template = await repos.roleplayTemplates.findById(validatedData.chat.roleplayTemplateId);
      if (!template) {
        return { error: 'Roleplay template not found', status: 404 };
      }
    }

    if (validatedData.chat.projectId !== undefined) {
      if (validatedData.chat.projectId !== null) {
        const project = await repos.projects.findById(validatedData.chat.projectId);
        if (!project || project.userId !== userId) {
          return { error: 'Project not found', status: 404 };
        }

        if (!project.allowAnyCharacter) {
          const characterIds = updatedChat.participants
            .filter((p) => p.type === 'CHARACTER' && p.characterId)
            .map((p) => p.characterId as string);

          const newCharacterIds = characterIds.filter((id) => !project.characterRoster.includes(id));
          if (newCharacterIds.length > 0) {
            await repos.projects.update(validatedData.chat.projectId, {
              characterRoster: [...project.characterRoster, ...newCharacterIds],
            });
          }
        }
      }
    }

    const result = await repos.chats.update(chatId, validatedData.chat);
    if (result) updatedChat = result;
  }

  if (validatedData.updateParticipant) {
    const result = await handleParticipantUpdate(chatId, validatedData.updateParticipant, userId, repos);
    if ('error' in result) return result;
    updatedChat = result.chat;
  }

  if (validatedData.addParticipant) {
    const result = await handleAddParticipant(
      chatId,
      validatedData.addParticipant,
      updatedChat.participants.length,
      userId,
      repos
    );
    if ('error' in result) return result;
    updatedChat = result.chat;
  }

  if (validatedData.removeParticipantId) {
    const result = await handleRemoveParticipant(chatId, validatedData.removeParticipantId, repos);
    if ('error' in result) return result;
    updatedChat = result.chat;
  }

  return { chat: updatedChat };
}

/**
 * Record a status change as a system event in the chat's message history.
 * This allows other characters to be notified in their next prompt.
 */
export async function recordStatusChangeEvent(
  chatId: string,
  characterName: string,
  oldStatus: string,
  newStatus: string,
  repos: Repos
): Promise<void> {
  const statusLabels: Record<string, string> = {
    active: 'active (speaking normally)',
    silent: 'silent (observing, not speaking)',
    absent: 'absent (away from the scene)',
    removed: 'removed (left the conversation)',
  };

  const description = `${characterName} changed from ${statusLabels[oldStatus] || oldStatus} to ${statusLabels[newStatus] || newStatus}`;

  const systemEvent = {
    id: crypto.randomUUID(),
    type: 'system' as const,
    systemEventType: 'STATUS_CHANGE' as const,
    description,
    createdAt: new Date().toISOString(),
  };

  try {
    await repos.chats.addMessage(chatId, systemEvent);
  } catch (error) {
    logger.error('[Chats v1] Failed to record status change event', { chatId, error: error instanceof Error ? error.message : String(error) });
  }
}
