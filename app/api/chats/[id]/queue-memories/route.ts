/**
 * Queue Memory Analysis API
 * POST /api/chats/[id]/queue-memories - Queue memory extraction jobs for a chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { enqueueMemoryExtractionBatch, ensureProcessorRunning, type MessagePair } from '@/lib/background-jobs';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import { notFound, badRequest, serverError } from '@/lib/api/responses';
import type { MessageEvent } from '@/lib/schemas/types';

/**
 * Extended message pair with character info for multi-character support
 */
interface MessagePairWithCharacter extends MessagePair {
  characterId: string;
  characterName: string;
}

/**
 * POST /api/chats/[id]/queue-memories
 * Queue memory extraction jobs for all message pairs in a chat
 *
 * In multi-character chats, respects each message's participantId to route
 * memories to the correct character.
 *
 * The connection profile for memory extraction is determined from the user's
 * cheap LLM settings - the front-end doesn't need to specify it.
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: AuthenticatedContext, { id: chatId }) => {
    try {
      const body = await req.json();
      const { characterId, characterName, messagePairs } = body;

      logger.debug('[QueueMemories] Request received', {
        chatId,
        characterId,
        userId: user.id,
      });

      // Verify chat belongs to user
      const chat = await repos.chats.findById(chatId);
      if (!chat || chat.userId !== user.id) {
        return notFound('Chat');
      }

      // Get cheap LLM settings to determine which connection profile to use
      const chatSettings = await repos.chatSettings.findByUserId(user.id);
      const cheapLLMSettings = chatSettings?.cheapLLMSettings;

      logger.debug('[QueueMemories] Cheap LLM settings', {
        strategy: cheapLLMSettings?.strategy,
        defaultCheapProfileId: cheapLLMSettings?.defaultCheapProfileId,
        userDefinedProfileId: cheapLLMSettings?.userDefinedProfileId,
      });

      // Determine connection profile based on strategy
      // Priority: defaultCheapProfileId (global override) > strategy-based selection
      let connectionProfileId: string | null | undefined = null;
      let profile = null;

      // Try global default first (if set and valid)
      if (cheapLLMSettings?.defaultCheapProfileId) {
        profile = await repos.connections.findById(cheapLLMSettings.defaultCheapProfileId);
        if (profile && profile.userId === user.id) {
          connectionProfileId = cheapLLMSettings.defaultCheapProfileId;
          logger.debug('[QueueMemories] Using global default cheap LLM', { profileId: connectionProfileId });
        }
      }

      // If no valid global default, use strategy-based selection
      if (!connectionProfileId && cheapLLMSettings?.strategy === 'USER_DEFINED' && cheapLLMSettings?.userDefinedProfileId) {
        profile = await repos.connections.findById(cheapLLMSettings.userDefinedProfileId);
        if (profile && profile.userId === user.id) {
          connectionProfileId = cheapLLMSettings.userDefinedProfileId;
          logger.debug('[QueueMemories] Using user-defined cheap LLM', { profileId: connectionProfileId });
        }
      }

      if (!connectionProfileId || !profile) {
        logger.warn('[QueueMemories] No valid cheap LLM configured', {
          userId: user.id,
          strategy: cheapLLMSettings?.strategy,
        });
        return badRequest('No valid cheap LLM configured. Please set a cheap LLM profile in settings.');
      }

      logger.debug('[QueueMemories] Using cheap LLM profile', {
        profileId: connectionProfileId,
        profileName: profile.name,
        provider: profile.provider,
      });

      // Build a map of participantId -> character info for multi-character support
      const participantCharacterMap = new Map<string, { characterId: string; characterName: string }>();
      for (const participant of chat.participants) {
        if (participant.type === 'CHARACTER' && participant.characterId) {
          const char = await repos.characters.findById(participant.characterId);
          if (char && char.userId === user.id) {
            participantCharacterMap.set(participant.id, {
              characterId: char.id,
              characterName: char.name,
            });
          }
        }
      }

      // Fallback character (the one passed in request, if valid)
      let fallbackCharacter: { characterId: string; characterName: string } | null = null;
      if (characterId) {
        const character = await repos.characters.findById(characterId);
        if (character && character.userId === user.id) {
          fallbackCharacter = {
            characterId: character.id,
            characterName: characterName || character.name,
          };
        }
      }

      // Use provided message pairs or build them from chat messages
      let pairsWithCharacter: MessagePairWithCharacter[];

      if (messagePairs && Array.isArray(messagePairs) && messagePairs.length > 0) {
        // Use provided pairs with fallback character
        if (!fallbackCharacter) {
          return notFound('Character');
        }
        pairsWithCharacter = messagePairs.map((pair: MessagePair) => ({
          ...pair,
          characterId: fallbackCharacter!.characterId,
          characterName: fallbackCharacter!.characterName,
        }));
      } else {
        // Build message pairs from chat messages, respecting each message's participantId
        // In multi-character chats, include all context since the last user message
        const messages = await repos.chats.getMessages(chatId);
        const messageList = messages.filter(
          (m): m is MessageEvent =>
            m.type === 'message' && (m.role === 'USER' || m.role === 'ASSISTANT')
        );

        // Helper to get character name for a participant
        const getParticipantName = (participantId: string | null | undefined): string => {
          if (!participantId) return 'Character';
          const charInfo = participantCharacterMap.get(participantId);
          return charInfo?.characterName || 'Character';
        };

        // Helper to get persona name for user messages
        const userParticipant = chat.participants.find(p => p.type === 'PERSONA');
        const personaName = userParticipant?.personaId
          ? (await repos.personas.findById(userParticipant.personaId))?.name || 'User'
          : 'User';

        pairsWithCharacter = [];

        // Track the index of the last user message
        let lastUserMessageIndex = -1;

        for (let i = 0; i < messageList.length; i++) {
          const msg = messageList[i];

          if (msg.role === 'USER') {
            lastUserMessageIndex = i;
          } else if (msg.role === 'ASSISTANT' && lastUserMessageIndex >= 0) {
            // This is an assistant message - create a memory extraction entry
            const userMessage = messageList[lastUserMessageIndex];

            // Determine which character this assistant message belongs to
            let targetCharacter = fallbackCharacter;
            if (msg.participantId) {
              const participantChar = participantCharacterMap.get(msg.participantId);
              if (participantChar) {
                targetCharacter = participantChar;
              }
            }

            // Skip if we couldn't determine the character
            if (!targetCharacter) {
              logger.warn('[QueueMemories] Skipping message - no character found', {
                chatId,
                assistantMessageId: msg.id,
                participantId: msg.participantId,
              });
              continue;
            }

            // Build context: include all messages from last user message to this assistant message
            // This captures multi-character exchanges
            let contextContent: string;

            if (i === lastUserMessageIndex + 1) {
              // Simple case: assistant message directly follows user message
              contextContent = userMessage.content;
            } else {
              // Multi-character case: include intervening messages for context
              const contextParts: string[] = [];
              contextParts.push(`${personaName}: ${userMessage.content}`);

              // Add all messages between user message and this assistant message
              for (let j = lastUserMessageIndex + 1; j < i; j++) {
                const intermediateMsg = messageList[j];
                if (intermediateMsg.role === 'ASSISTANT') {
                  const speakerName = getParticipantName(intermediateMsg.participantId);
                  contextParts.push(`${speakerName}: ${intermediateMsg.content}`);
                }
              }

              contextContent = contextParts.join('\n\n');
            }

            pairsWithCharacter.push({
              userMessageId: userMessage.id,
              assistantMessageId: msg.id,
              userContent: contextContent,
              assistantContent: msg.content,
              characterId: targetCharacter.characterId,
              characterName: targetCharacter.characterName,
            });
          }
        }
      }

      if (pairsWithCharacter.length === 0) {
        return badRequest('No message pairs found to analyze');
      }

      // Group pairs by character for efficient batch processing
      const pairsByCharacter = new Map<string, { characterName: string; pairs: MessagePair[] }>();
      for (const pair of pairsWithCharacter) {
        const existing = pairsByCharacter.get(pair.characterId);
        if (existing) {
          existing.pairs.push({
            userMessageId: pair.userMessageId,
            assistantMessageId: pair.assistantMessageId,
            userContent: pair.userContent,
            assistantContent: pair.assistantContent,
          });
        } else {
          pairsByCharacter.set(pair.characterId, {
            characterName: pair.characterName,
            pairs: [{
              userMessageId: pair.userMessageId,
              assistantMessageId: pair.assistantMessageId,
              userContent: pair.userContent,
              assistantContent: pair.assistantContent,
            }],
          });
        }
      }

      logger.info('[QueueMemories] Queueing memory extraction jobs', {
        chatId,
        characterCount: pairsByCharacter.size,
        totalPairs: pairsWithCharacter.length,
      });

      // Queue jobs for each character
      const allJobIds: string[] = [];
      for (const [charId, { characterName: charName, pairs }] of pairsByCharacter) {
        const jobIds = await enqueueMemoryExtractionBatch(
          user.id,
          chatId,
          charId,
          charName,
          connectionProfileId,
          pairs,
          { priority: 0 } // Low priority for bulk operations
        );
        allJobIds.push(...jobIds);
      }

      // Start the processor if not already running
      ensureProcessorRunning();

      return NextResponse.json({
        success: true,
        jobCount: allJobIds.length,
        chatId,
        characterCount: pairsByCharacter.size,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('[QueueMemories] Error', { error: errorMessage });
      return serverError(errorMessage);
    }
  }
);
