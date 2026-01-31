/**
 * First-Startup Seed Data Loader
 *
 * Loads and exports seed data for initial application setup.
 * This module provides type-safe access to seed characters and
 * embedding profiles that are created when the application starts
 * with an empty database.
 *
 * @module first-startup
 */

import { CharacterInput, EmbeddingProfile } from '@/lib/schemas/types';
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

// ============================================================================
// EMBEDDING PROFILES
// ============================================================================

/**
 * Seed embedding profile data structure
 */
export interface SeedEmbeddingProfileData {
  name: string;
  provider: 'OPENAI' | 'OLLAMA' | 'OPENROUTER' | 'BUILTIN';
  modelName: string;
  dimensions?: number | null;
  isDefault: boolean;
}

/**
 * Default TF-IDF embedding profile for first startup
 * This provides zero-config semantic search without requiring API keys
 */
const defaultEmbeddingProfile: SeedEmbeddingProfileData = {
  name: 'Built-in TF-IDF',
  provider: 'BUILTIN',
  modelName: 'tfidf-bm25-v1',
  dimensions: null, // Determined dynamically based on vocabulary
  isDefault: true,
};

/**
 * Get all seed embedding profiles to be created on first startup
 * @returns Array of seed embedding profile data
 */
export function getSeedEmbeddingProfiles(): SeedEmbeddingProfileData[] {
  return [defaultEmbeddingProfile];
}

/**
 * Prepare seed embedding profile data for insertion into the database
 *
 * @param seedData The seed embedding profile data
 * @param userId The user ID to assign to the profile
 * @returns Embedding profile data ready for repository.create()
 */
export function prepareSeedEmbeddingProfile(
  seedData: SeedEmbeddingProfileData,
  userId: string
): Omit<EmbeddingProfile, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    userId,
    name: seedData.name,
    provider: seedData.provider,
    apiKeyId: null,
    baseUrl: null,
    modelName: seedData.modelName,
    dimensions: seedData.dimensions ?? null,
    isDefault: seedData.isDefault,
    tags: [],
  };
}
