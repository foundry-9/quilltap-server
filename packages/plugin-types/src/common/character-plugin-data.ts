/**
 * Character Plugin Data Types
 *
 * Types for per-character, per-plugin metadata storage.
 * Plugins can store arbitrary JSON data associated with a character.
 *
 * @module @quilltap/plugin-types/common/character-plugin-data
 */

/**
 * A single character plugin data entry as returned by the API.
 *
 * Plugins interact with this through the REST API:
 * - GET /api/v1/characters/[id]/plugin-data - Get all plugin data for a character
 * - POST /api/v1/characters/[id]/plugin-data - Upsert data (body: { pluginName, data })
 * - GET /api/v1/characters/[id]/plugin-data/[pluginName] - Get specific plugin's data
 * - PUT /api/v1/characters/[id]/plugin-data/[pluginName] - Replace data
 * - DELETE /api/v1/characters/[id]/plugin-data/[pluginName] - Delete data
 */
export interface CharacterPluginDataEntry {
  /** Unique ID for this entry */
  id: string;

  /** Character this data belongs to */
  characterId: string;

  /** Plugin name (must match plugin manifest name) */
  pluginName: string;

  /** Arbitrary JSON data */
  data: unknown;

  /** ISO-8601 timestamp when this entry was created */
  createdAt: string;

  /** ISO-8601 timestamp when this entry was last updated */
  updatedAt: string;
}

/**
 * Map of plugin data for a character, keyed by plugin name.
 * Returned by GET /api/v1/characters/[id]/plugin-data
 */
export type CharacterPluginDataMap = Record<string, unknown>;
