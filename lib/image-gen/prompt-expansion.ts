/**
 * Image Prompt Expansion Utilities
 *
 * Handles parsing of placeholders like {{CharacterName}} or {{me}} in image generation prompts
 * and retrieves appropriate physical descriptions from the database.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { PhysicalDescription, ImageProvider } from '@/lib/schemas/types';

/**
 * Placeholder information extracted from a prompt
 */
export interface PlaceholderInfo {
  /** Original placeholder text (e.g., "{{Mirel}}") */
  placeholder: string;
  /** Entity name (e.g., "Mirel") */
  name: string;
  /** Entity type - 'character' for all characters (LLM or user-controlled), 'user' for unknown/default */
  type: 'character' | 'user';
  /** Entity ID if found */
  entityId?: string;
  /** All available physical descriptions for this entity */
  descriptions?: PhysicalDescription[];
}

/**
 * Provider-specific character limits for image prompts
 */
const PROVIDER_LIMITS: Record<ImageProvider, number> = {
  OPENAI: 4000,           // DALL-E 3
  GROK: 700,              // Grok (conservative estimate)
  GOOGLE_IMAGEN: 1920,    // ~480 tokens at 4 chars/token
};

/**
 * Parse placeholders from an image prompt
 * Supports {{name}} syntax
 *
 * @param prompt - The prompt containing placeholders
 * @returns Array of placeholder information
 */
export function parsePlaceholders(prompt: string): Array<{ placeholder: string; name: string }> {
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  const placeholders: Array<{ placeholder: string; name: string }> = [];

  let match;
  while ((match = placeholderRegex.exec(prompt)) !== null) {
    placeholders.push({
      placeholder: match[0],  // Full match: {{Mirel}}
      name: match[1].trim(),  // Captured group: Mirel
    });
  }

  return placeholders;
}

/**
 * Resolve placeholders to entity information
 *
 * @param placeholders - Parsed placeholders
 * @param userId - Current user ID
 * @param chatId - Optional chat ID for context
 * @param callingParticipantId - Optional participant ID of who's calling the tool (for {{me}}/{{I}})
 * @returns Array of resolved placeholder info
 */
export async function resolvePlaceholders(
  placeholders: Array<{ placeholder: string; name: string }>,
  userId: string,
  chatId?: string,
  callingParticipantId?: string
): Promise<PlaceholderInfo[]> {
  const repos = getRepositories();
  const resolved: PlaceholderInfo[] = [];

  // Pre-fetch chat data if we have a chatId
  let chat: Awaited<ReturnType<typeof repos.chats.findById>> | null = null;
  if (chatId) {
    chat = await repos.chats.findById(chatId);
  }

  for (const { placeholder, name } of placeholders) {
    const lowerName = name.toLowerCase();

    // {{me}}, {{I}}, or {{char}} = the caller (character when assistant calls, user-controlled character when user calls)
    if (lowerName === 'me' || lowerName === 'i' || lowerName === 'char') {
      let descriptions: PhysicalDescription[] = [];
      let entityId: string | undefined;
      let entityType: 'character' | 'user' = 'user';
      let resolvedName = name;

      // If we have a calling participant, use that
      if (callingParticipantId && chat) {
        const participant = chat.participants.find(p => p.id === callingParticipantId);
        if (participant) {
          // All participants are now CHARACTER type (personas migrated to characters with controlledBy: 'user')
          // For legacy PERSONA participants, personaId === characterId after migration
          const characterId = participant.characterId || participant.personaId;
          if (characterId) {
            const character = await repos.characters.findById(characterId);
            if (character) {
              descriptions = character.physicalDescriptions || [];
              entityId = character.id;
              entityType = 'character';
              resolvedName = character.name;
            }
          }
        }
      } else if (chat) {
        // No calling participant specified - fall back to first character (likely assistant-initiated)
        const characterParticipant = chat.participants.find(p => p.type === 'CHARACTER');
        if (characterParticipant?.characterId) {
          const character = await repos.characters.findById(characterParticipant.characterId);
          if (character) {
            descriptions = character.physicalDescriptions || [];
            entityId = character.id;
            entityType = 'character';
            resolvedName = character.name;
          }
        }
      }

      resolved.push({
        placeholder,
        name: resolvedName,
        type: entityType,
        entityId,
        descriptions,
      });
      continue;
    }

    // {{user}} = the OTHER participant (user-controlled character when LLM calls, LLM character when user calls)
    if (lowerName === 'user') {
      let descriptions: PhysicalDescription[] = [];
      let entityId: string | undefined;
      let entityType: 'character' | 'user' = 'character';
      let resolvedName = name;

      if (chat) {
        // Find the "other" participant - the one with different controlledBy or the user-controlled one
        // After migration, all participants are CHARACTER type with controlledBy: 'llm' or 'user'
        let otherParticipant = null;

        if (callingParticipantId) {
          const callerParticipant = chat.participants.find(p => p.id === callingParticipantId);
          if (callerParticipant) {
            // If caller is LLM-controlled, find user-controlled participant
            // If caller is user-controlled, find LLM-controlled participant
            const callerIsUserControlled = callerParticipant.controlledBy === 'user' || callerParticipant.type === 'PERSONA';
            otherParticipant = chat.participants.find(p =>
              p.id !== callingParticipantId &&
              (callerIsUserControlled
                ? (p.controlledBy === 'llm' || p.controlledBy === undefined) && p.type !== 'PERSONA'
                : p.controlledBy === 'user' || p.type === 'PERSONA')
            );
          }
        }

        // If no caller specified, find the first user-controlled participant
        if (!otherParticipant) {
          otherParticipant = chat.participants.find(p =>
            p.controlledBy === 'user' || p.type === 'PERSONA'
          );
        }

        if (otherParticipant) {
          // All participants are characters now - personaId === characterId after migration
          const characterId = otherParticipant.characterId || otherParticipant.personaId;
          if (characterId) {
            const character = await repos.characters.findById(characterId);
            if (character) {
              descriptions = character.physicalDescriptions || [];
              entityId = character.id;
              entityType = 'character';
              resolvedName = character.name;
            }
          }
        }
      }

      resolved.push({
        placeholder,
        name: resolvedName,
        type: entityType,
        entityId,
        descriptions,
      });
      continue;
    }

    // Try to find a character by name (includes former personas which are now characters with controlledBy: 'user')
    const characters = await repos.characters.findByUserId(userId);
    const character = characters.find(c => c.name.toLowerCase() === lowerName);

    if (character) {
      resolved.push({
        placeholder,
        name: character.name,
        type: 'character',
        entityId: character.id,
        descriptions: character.physicalDescriptions || [],
      });
      continue;
    }

    // Placeholder not found - include with no descriptions
    resolved.push({
      placeholder,
      name,
      type: 'character', // Default to character type
      descriptions: [],
    });
  }

  return resolved;
}

/**
 * Get all available description tiers for an entity
 *
 * @param descriptions - Available physical descriptions for an entity
 * @returns Object with all available description tiers
 */
export function getAllDescriptionTiers(
  descriptions: PhysicalDescription[]
): {
  short?: string;
  medium?: string;
  long?: string;
  complete?: string;
  entityName?: string;
} | null {
  if (!descriptions || descriptions.length === 0) {
    return null;
  }

  // Use the first/primary description
  const primary = descriptions[0];

  return {
    short: primary.shortPrompt || undefined,
    medium: primary.mediumPrompt || undefined,
    long: primary.longPrompt || undefined,
    complete: primary.completePrompt || undefined,
    entityName: primary.name,
  };
}

/**
 * Calculate available space for descriptions in a prompt
 *
 * @param basePrompt - The original prompt with placeholders
 * @param placeholderCount - Number of placeholders to substitute
 * @param provider - Image generation provider
 * @returns Available characters per placeholder (approximate)
 */
export function calculateAvailableSpace(
  basePrompt: string,
  placeholderCount: number,
  provider: ImageProvider
): number {
  const limit = PROVIDER_LIMITS[provider];

  // Remove placeholders from the base prompt to get actual text length
  const promptWithoutPlaceholders = basePrompt.replace(/\{\{[^}]+\}\}/g, '');
  const baseLength = promptWithoutPlaceholders.length;

  // Reserve some space for LLM-added connectors/formatting (20% buffer)
  const reservedSpace = Math.ceil(limit * 0.2);

  // Calculate space available for all descriptions
  const availableForDescriptions = limit - baseLength - reservedSpace;

  // Divide equally among placeholders
  const perPlaceholder = Math.floor(availableForDescriptions / placeholderCount);

  // Ensure minimum of 50 characters per placeholder
  return Math.max(50, perPlaceholder);
}

/**
 * Build context for cheap LLM prompt crafting
 *
 * @param originalPrompt - Original prompt with placeholders
 * @param resolvedPlaceholders - Resolved placeholder information
 * @param provider - Target image generation provider
 * @returns Context object for cheap LLM
 */
export function buildExpansionContext(
  originalPrompt: string,
  resolvedPlaceholders: PlaceholderInfo[],
  provider: ImageProvider
): {
  originalPrompt: string;
  placeholders: Array<{
    placeholder: string;
    name: string;
    tiers: {
      short?: string;
      medium?: string;
      long?: string;
      complete?: string;
    };
  }>;
  targetLength: number;
  provider: string;
} {
  const placeholderData = resolvedPlaceholders.map(placeholder => {
    const tiers = getAllDescriptionTiers(placeholder.descriptions || []);

    return {
      placeholder: placeholder.placeholder,
      name: placeholder.name,
      tiers: {
        short: tiers?.short,
        medium: tiers?.medium,
        long: tiers?.long,
        complete: tiers?.complete,
      },
    };
  });

  return {
    originalPrompt,
    placeholders: placeholderData,
    targetLength: PROVIDER_LIMITS[provider],
    provider,
  };
}

/**
 * Main function to expand a prompt with placeholders
 * This prepares the data needed for the cheap LLM to craft the final prompt
 *
 * @param prompt - Original prompt with placeholders
 * @param userId - Current user ID
 * @param provider - Target image generation provider
 * @param chatId - Optional chat ID for context
 * @param callingParticipantId - Optional participant ID of who's calling the tool
 * @returns Expansion context for cheap LLM
 */
export async function preparePromptExpansion(
  prompt: string,
  userId: string,
  provider: ImageProvider,
  chatId?: string,
  callingParticipantId?: string
): Promise<{
  hasPlaceholders: boolean;
  originalPrompt: string;
  placeholders?: Array<{
    placeholder: string;
    name: string;
    tiers: {
      short?: string;
      medium?: string;
      long?: string;
      complete?: string;
    };
  }>;
  targetLength: number;
  provider: string;
}> {
  const placeholders = parsePlaceholders(prompt);

  if (placeholders.length === 0) {
    return {
      hasPlaceholders: false,
      originalPrompt: prompt,
      targetLength: PROVIDER_LIMITS[provider],
      provider,
    };
  }

  const resolved = await resolvePlaceholders(placeholders, userId, chatId, callingParticipantId);
  const context = buildExpansionContext(prompt, resolved, provider);

  return {
    hasPlaceholders: true,
    ...context,
  };
}
