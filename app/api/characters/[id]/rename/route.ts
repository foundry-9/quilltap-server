/**
 * Character Rename API
 *
 * Provides endpoints to:
 * 1. Preview a name change across all associated data (character fields, memories, chat messages)
 * 2. Execute a search and replace for the character name and optional aliases
 *
 * POST /api/characters/[id]/rename
 *   - Preview mode (dryRun: true): Returns counts of what would be changed
 *   - Execute mode (dryRun: false): Performs the replacements and returns counts
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { CharactersRepository } from '@/lib/mongodb/repositories/characters.repository';
import { MemoriesRepository } from '@/lib/mongodb/repositories/memories.repository';
import { MongoChatsRepository } from '@/lib/mongodb/repositories/chats.repository';
import { logger } from '@/lib/logger';

const charactersRepository = new CharactersRepository();
const memoriesRepository = new MemoriesRepository();
const chatsRepository = new MongoChatsRepository();

// Schema for a single replacement pair
const ReplacementPairSchema = z.object({
  oldValue: z.string().min(1, 'Old value is required'),
  newValue: z.string().min(1, 'New value is required'),
  caseSensitive: z.boolean().default(false),
});

// Schema for the rename request
const RenameRequestSchema = z.object({
  // Primary character name replacement
  primaryRename: ReplacementPairSchema.optional(),

  // Additional replacements (nicknames, aliases, etc.)
  additionalReplacements: z.array(ReplacementPairSchema).default([]),

  // If true, only returns what would be changed without making changes
  dryRun: z.boolean().default(true),
});

type ReplacementPair = z.infer<typeof ReplacementPairSchema>;

interface ReplacementResult {
  field: string;
  location: string;
  oldText: string;
  newText: string;
  context?: string; // Surrounding text for preview
}

interface RenamePreviewResponse {
  characterId: string;
  characterName: string;
  dryRun: boolean;
  replacements: ReplacementResult[];
  summary: {
    characterFields: number;
    physicalDescriptions: number;
    memories: number;
    chatTitles: number;
    chatMessages: number;
    total: number;
  };
}

/**
 * Performs search and replace on a string, returning the new string and whether a change was made
 */
function performReplacement(
  text: string | null | undefined,
  pair: ReplacementPair
): { result: string | null; changed: boolean; matches: number } {
  if (!text) {
    return { result: null, changed: false, matches: 0 };
  }

  const flags = pair.caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegex(pair.oldValue), flags);
  const matches = (text.match(regex) || []).length;

  if (matches === 0) {
    return { result: text, changed: false, matches: 0 };
  }

  const newText = text.replace(regex, pair.newValue);
  return { result: newText, changed: true, matches };
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Gets a snippet of context around a match
 */
function getContext(text: string, searchTerm: string, maxLength: number = 100): string {
  const lowerText = text.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  const index = lowerText.indexOf(lowerSearch);

  if (index === -1) return text.slice(0, maxLength);

  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + searchTerm.length + 30);

  let context = text.slice(start, end);
  if (start > 0) context = '...' + context;
  if (end < text.length) context = context + '...';

  return context;
}

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (request, { user, repos }, { id: characterId }) => {
    const startTime = Date.now();

    logger.debug('Character rename request started', { characterId });

    try {
      const userId = user.id;

      // Verify character exists and belongs to user
      const character = await charactersRepository.findById(characterId);
      if (!character) {
        logger.warn('Character not found for rename', { characterId, userId });
        return NextResponse.json({ error: 'Character not found' }, { status: 404 });
      }

      if (character.userId !== userId) {
        logger.warn('Unauthorized rename attempt - wrong user', { characterId, userId, ownerId: character.userId });
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }

      // Parse and validate request body
      const body = await request.json();
      const validationResult = RenameRequestSchema.safeParse(body);

      if (!validationResult.success) {
        logger.debug('Invalid rename request body', {
          characterId,
          errors: validationResult.error.errors
        });
        return NextResponse.json(
          { error: 'Invalid request', details: validationResult.error.errors },
          { status: 400 }
        );
      }

      const { primaryRename, additionalReplacements, dryRun } = validationResult.data;

      // Combine all replacements
      const allReplacements: ReplacementPair[] = [];
      if (primaryRename) {
        allReplacements.push(primaryRename);
      }
      allReplacements.push(...additionalReplacements);

      if (allReplacements.length === 0) {
        logger.debug('No replacements specified', { characterId });
        return NextResponse.json(
          { error: 'At least one replacement must be specified' },
          { status: 400 }
        );
      }

      logger.debug('Processing rename request', {
        characterId,
        dryRun,
        replacementCount: allReplacements.length,
        primaryRename: primaryRename ? { old: primaryRename.oldValue, new: primaryRename.newValue } : null,
      });

      const replacements: ReplacementResult[] = [];
      const summary = {
        characterFields: 0,
        physicalDescriptions: 0,
        memories: 0,
        chatTitles: 0,
        chatMessages: 0,
        total: 0,
      };

      // =========================================================================
      // 1. Process Character Fields
      // =========================================================================
      const characterFields: (keyof typeof character)[] = [
        'name', 'title', 'description', 'personality', 'scenario',
        'firstMessage', 'exampleDialogues'
      ];

      const characterUpdates: Record<string, string> = {};

      for (const field of characterFields) {
        const value = character[field];
        if (typeof value !== 'string') continue;

        let currentValue = value;
        let fieldChanged = false;

        for (const pair of allReplacements) {
          const { result, changed, matches } = performReplacement(currentValue, pair);
          if (changed && result) {
            replacements.push({
              field,
              location: `Character: ${character.name}`,
              oldText: pair.oldValue,
              newText: pair.newValue,
              context: getContext(currentValue, pair.oldValue),
            });
            currentValue = result;
            fieldChanged = true;
            summary.characterFields += matches;
          }
        }

        if (fieldChanged) {
          characterUpdates[field] = currentValue;
        }
      }

      // =========================================================================
      // 2. Process System Prompts
      // =========================================================================
      const systemPrompts = character.systemPrompts || [];
      const updatedSystemPrompts = [...systemPrompts];
      let systemPromptsChanged = false;

      for (let i = 0; i < updatedSystemPrompts.length; i++) {
        const prompt = updatedSystemPrompts[i];
        const promptFields: (keyof typeof prompt)[] = ['name', 'content'];

        for (const field of promptFields) {
          const value = prompt[field];
          if (typeof value !== 'string') continue;

          let currentValue = value;
          let fieldChanged = false;

          for (const pair of allReplacements) {
            const { result, changed, matches } = performReplacement(currentValue, pair);
            if (changed && result) {
              replacements.push({
                field: `systemPrompt.${field}`,
                location: `System Prompt: ${prompt.name}`,
                oldText: pair.oldValue,
                newText: pair.newValue,
                context: getContext(currentValue, pair.oldValue),
              });
              currentValue = result;
              fieldChanged = true;
              summary.characterFields += matches;
            }
          }

          if (fieldChanged) {
            (updatedSystemPrompts[i] as any)[field] = currentValue;
            systemPromptsChanged = true;
          }
        }
      }

      if (systemPromptsChanged) {
        characterUpdates.systemPrompts = updatedSystemPrompts as any;
      }

      // =========================================================================
      // 3. Process Physical Descriptions
      // =========================================================================
      const physicalDescriptions = character.physicalDescriptions || [];
      const updatedDescriptions = [...physicalDescriptions];
      let descriptionsChanged = false;

      for (let i = 0; i < updatedDescriptions.length; i++) {
        const desc = updatedDescriptions[i];
        const descFields: (keyof typeof desc)[] = [
          'name', 'shortPrompt', 'mediumPrompt', 'longPrompt', 'completePrompt', 'fullDescription'
        ];

        for (const field of descFields) {
          const value = desc[field];
          if (typeof value !== 'string') continue;

          let currentValue = value;
          let fieldChanged = false;

          for (const pair of allReplacements) {
            const { result, changed, matches } = performReplacement(currentValue, pair);
            if (changed && result) {
              replacements.push({
                field: `physicalDescription.${field}`,
                location: `Description: ${desc.name}`,
                oldText: pair.oldValue,
                newText: pair.newValue,
                context: getContext(currentValue, pair.oldValue),
              });
              currentValue = result;
              fieldChanged = true;
              summary.physicalDescriptions += matches;
            }
          }

          if (fieldChanged) {
            (updatedDescriptions[i] as any)[field] = currentValue;
            descriptionsChanged = true;
          }
        }
      }

      if (descriptionsChanged) {
        characterUpdates.physicalDescriptions = updatedDescriptions as any;
      }

      // =========================================================================
      // 4. Process Memories
      // =========================================================================
      const memories = await memoriesRepository.findByCharacterId(characterId);
      const memoryUpdates: Array<{ id: string; updates: Partial<{ content: string; summary: string; keywords: string[] }> }> = [];

      for (const memory of memories) {
        const updates: Partial<{ content: string; summary: string; keywords: string[] }> = {};
        let memoryChanged = false;

        // Process content
        let currentContent = memory.content;
        for (const pair of allReplacements) {
          const { result, changed, matches } = performReplacement(currentContent, pair);
          if (changed && result) {
            replacements.push({
              field: 'memory.content',
              location: `Memory: ${memory.id.slice(0, 8)}...`,
              oldText: pair.oldValue,
              newText: pair.newValue,
              context: getContext(currentContent, pair.oldValue),
            });
            currentContent = result;
            memoryChanged = true;
            summary.memories += matches;
          }
        }
        if (currentContent !== memory.content) {
          updates.content = currentContent;
        }

        // Process summary
        let currentSummary = memory.summary;
        for (const pair of allReplacements) {
          const { result, changed, matches } = performReplacement(currentSummary, pair);
          if (changed && result) {
            replacements.push({
              field: 'memory.summary',
              location: `Memory: ${memory.id.slice(0, 8)}...`,
              oldText: pair.oldValue,
              newText: pair.newValue,
              context: getContext(currentSummary, pair.oldValue),
            });
            currentSummary = result;
            memoryChanged = true;
            summary.memories += matches;
          }
        }
        if (currentSummary !== memory.summary) {
          updates.summary = currentSummary;
        }

        // Process keywords
        if (memory.keywords && memory.keywords.length > 0) {
          const updatedKeywords = memory.keywords.map(keyword => {
            let currentKeyword = keyword;
            for (const pair of allReplacements) {
              const { result, changed } = performReplacement(currentKeyword, pair);
              if (changed && result) {
                currentKeyword = result;
                memoryChanged = true;
              }
            }
            return currentKeyword;
          });
          if (JSON.stringify(updatedKeywords) !== JSON.stringify(memory.keywords)) {
            updates.keywords = updatedKeywords;
          }
        }

        if (memoryChanged && Object.keys(updates).length > 0) {
          memoryUpdates.push({ id: memory.id, updates });
        }
      }

      // =========================================================================
      // 5. Process Chat Conversations
      // =========================================================================
      const chats = await chatsRepository.findByCharacterId(characterId);
      const chatUpdates: Array<{ chatId: string; titleUpdate?: string; messageUpdates: Array<{ messageId: string; content: string }> }> = [];

      for (const chat of chats) {
        let chatChanged = false;
        let updatedTitle = chat.title;
        const messageUpdates: Array<{ messageId: string; content: string }> = [];

        // Process chat title
        for (const pair of allReplacements) {
          const { result, changed, matches } = performReplacement(updatedTitle, pair);
          if (changed && result) {
            replacements.push({
              field: 'chat.title',
              location: `Chat: ${chat.title}`,
              oldText: pair.oldValue,
              newText: pair.newValue,
              context: getContext(updatedTitle, pair.oldValue),
            });
            updatedTitle = result;
            chatChanged = true;
            summary.chatTitles += matches;
          }
        }

        // Process chat messages
        const messages = await chatsRepository.getMessages(chat.id);
        for (const message of messages) {
          if (message.type !== 'message') continue;

          let currentContent = message.content;
          let messageChanged = false;

          for (const pair of allReplacements) {
            const { result, changed, matches } = performReplacement(currentContent, pair);
            if (changed && result) {
              replacements.push({
                field: 'chat.message',
                location: `Chat: ${chat.title}`,
                oldText: pair.oldValue,
                newText: pair.newValue,
                context: getContext(currentContent, pair.oldValue),
              });
              currentContent = result;
              messageChanged = true;
              summary.chatMessages += matches;
            }
          }

          if (messageChanged) {
            messageUpdates.push({ messageId: message.id, content: currentContent });
          }
        }

        if (chatChanged || messageUpdates.length > 0) {
          chatUpdates.push({
            chatId: chat.id,
            titleUpdate: updatedTitle !== chat.title ? updatedTitle : undefined,
            messageUpdates,
          });
        }
      }

      // Calculate total
      summary.total = summary.characterFields + summary.physicalDescriptions +
                      summary.memories + summary.chatTitles + summary.chatMessages;

      // =========================================================================
      // 6. Execute Updates (if not dry run)
      // =========================================================================
      if (!dryRun) {
        logger.info('Executing character rename', {
          characterId,
          characterName: character.name,
          replacementCount: allReplacements.length,
          totalChanges: summary.total,
        });

        // Update character fields
        if (Object.keys(characterUpdates).length > 0) {
          await charactersRepository.update(characterId, characterUpdates as any);
          logger.debug('Updated character fields', { characterId, fields: Object.keys(characterUpdates) });
        }

        // Update memories
        for (const { id, updates } of memoryUpdates) {
          await memoriesRepository.update(id, updates);
          logger.debug('Updated memory', { memoryId: id });
        }

        // Update chats
        for (const { chatId, titleUpdate, messageUpdates } of chatUpdates) {
          if (titleUpdate) {
            await chatsRepository.update(chatId, { title: titleUpdate });
            logger.debug('Updated chat title', { chatId });
          }

          for (const { messageId, content } of messageUpdates) {
            await chatsRepository.updateMessage(chatId, messageId, { content });
            logger.debug('Updated chat message', { chatId, messageId });
          }
        }

        logger.info('Character rename completed', {
          characterId,
          duration: Date.now() - startTime,
          summary,
        });
      } else {
        logger.debug('Rename dry run completed', {
          characterId,
          duration: Date.now() - startTime,
          summary,
        });
      }

      const response: RenamePreviewResponse = {
        characterId,
        characterName: character.name,
        dryRun,
        replacements,
        summary,
      };

      return NextResponse.json(response);

    } catch (error) {
      logger.error('Character rename failed', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      return NextResponse.json(
        { error: 'Failed to process rename request' },
        { status: 500 }
      );
    }
  }
);
