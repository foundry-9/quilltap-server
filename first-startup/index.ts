/**
 * First-Startup Seed Data Loader
 *
 * Loads and exports seed data for initial application setup.
 * This module provides type-safe access to seed characters that
 * are created when the application starts with an empty database.
 *
 * @module first-startup
 */

import { CharacterInput } from '@/lib/schemas/types';
import benData from './characters/ben.json';

/**
 * Seed character data structure (without system-generated fields)
 * This matches the CharacterInput type but excludes id, userId, createdAt, updatedAt
 */
export interface SeedCharacterData {
  name: string;
  title?: string | null;
  description?: string | null;
  personality?: string | null;
  systemPrompts?: Array<{
    name: string;
    content: string;
    isDefault?: boolean;
  }>;
  controlledBy?: 'llm' | 'user';
  talkativeness?: number;
  npc?: boolean;
  isFavorite?: boolean;
}

/**
 * Generate a UUID v4
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get current ISO-8601 timestamp
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Get all seed characters to be created on first startup
 * @returns Array of seed character data
 */
export function getSeedCharacters(): SeedCharacterData[] {
  return [benData as SeedCharacterData];
}

/**
 * Prepare seed character data for insertion into the database
 * Converts seed data to the format expected by the repository
 *
 * @param seedData The seed character data
 * @param userId The user ID to assign to the character
 * @returns Character data ready for repository.create()
 */
export function prepareSeedCharacter(
  seedData: SeedCharacterData,
  userId: string
): Omit<CharacterInput, 'id' | 'createdAt' | 'updatedAt'> {
  const now = getCurrentTimestamp();

  return {
    userId,
    name: seedData.name,
    title: seedData.title ?? null,
    description: seedData.description ?? null,
    personality: seedData.personality ?? null,
    systemPrompts: (seedData.systemPrompts ?? []).map(prompt => ({
      id: generateId(),
      name: prompt.name,
      content: prompt.content,
      isDefault: prompt.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    })),
    controlledBy: seedData.controlledBy ?? 'llm',
    talkativeness: seedData.talkativeness ?? 0.5,
    npc: seedData.npc ?? false,
    isFavorite: seedData.isFavorite ?? false,
  };
}
