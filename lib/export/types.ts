/**
 * Export/Import System Types
 *
 * Defines TypeScript interfaces and types for the Quilltap export/import system,
 * supporting selective entity exports with optional memory inclusion.
 */

import type {
  Character,
  Persona,
  ChatMetadata,
  Tag,
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
  Memory,
  MessageEvent,
  RoleplayTemplate,
} from '@/lib/schemas/types';

// ============================================================================
// EXPORT ENTITY TYPES
// ============================================================================

/**
 * Types of entities that can be exported
 * Each export contains a single entity type (no mixed exports)
 */
export type ExportEntityType =
  | 'characters'
  | 'personas'
  | 'chats'
  | 'roleplay-templates'
  | 'connection-profiles'
  | 'image-profiles'
  | 'embedding-profiles'
  | 'tags';

// ============================================================================
// EXPORT MANIFEST
// ============================================================================

/**
 * Settings for an export operation
 */
export interface QuilltapExportSettings {
  /** Whether to include memories associated with exported entities */
  includeMemories: boolean;
  /** Scope of export: 'all' for all entities of type, 'selected' for specific IDs */
  scope: 'all' | 'selected';
  /** List of entity IDs to export (only used when scope is 'selected') */
  selectedIds: string[];
}

/**
 * Entity counts included in the export
 */
export interface QuilltapExportCounts {
  characters?: number;
  personas?: number;
  chats?: number;
  messages?: number;
  roleplayTemplates?: number;
  connectionProfiles?: number;
  imageProfiles?: number;
  embeddingProfiles?: number;
  tags?: number;
  memories?: number;
}

/**
 * Metadata about an export
 *
 * Included in every export to support version-aware imports and provide
 * summary information for display to users.
 */
export interface QuilltapExportManifest {
  /** Export format identifier */
  format: 'quilltap-export';
  /** Format version (currently '1.0') */
  version: '1.0';
  /** Type of entity being exported */
  exportType: ExportEntityType;
  /** ISO 8601 timestamp of when the export was created */
  createdAt: string;
  /** Application version at export time */
  appVersion: string;
  /** Export configuration settings */
  settings: QuilltapExportSettings;
  /** Counts of exported entities for validation and progress tracking */
  counts: QuilltapExportCounts;
}

// ============================================================================
// EXPORTED ENTITY TYPES WITH METADATA
// ============================================================================

/**
 * Character with resolved relationships
 */
export interface ExportedCharacter extends Character {
  _linkedPersonaNames?: string[];
  _tagNames?: string[];
}

/**
 * Persona with resolved relationships
 */
export interface ExportedPersona extends Persona {
  _linkedCharacterNames?: string[];
  _tagNames?: string[];
}

/**
 * Chat with messages and resolved participant information
 */
export interface ExportedChat extends ChatMetadata {
  messages: MessageEvent[];
  _participantInfo?: Array<{
    participantId: string;
    characterName?: string;
    personaName?: string;
    type: 'CHARACTER' | 'PERSONA';
  }>;
  _tagNames?: string[];
}

/**
 * Roleplay template (user-created only, excludes built-in)
 */
export interface ExportedRoleplayTemplate extends RoleplayTemplate {
  _tagNames?: string[];
}

/**
 * Connection profile with sanitized API key reference
 * Actual API key is never exported for security
 */
export interface SanitizedConnectionProfile extends Omit<ConnectionProfile, 'apiKeyId'> {
  _apiKeyLabel?: string;
}

/**
 * Image profile with sanitized API key reference
 */
export interface SanitizedImageProfile extends Omit<ImageProfile, 'apiKeyId'> {
  _apiKeyLabel?: string;
}

/**
 * Embedding profile with sanitized API key reference
 */
export interface SanitizedEmbeddingProfile extends Omit<EmbeddingProfile, 'apiKeyId'> {
  _apiKeyLabel?: string;
}

// ============================================================================
// EXPORT DATA STRUCTURE
// ============================================================================

/**
 * Character export data
 */
export interface CharactersExportData {
  characters: ExportedCharacter[];
  memories?: Memory[];
}

/**
 * Persona export data
 */
export interface PersonasExportData {
  personas: ExportedPersona[];
  memories?: Memory[];
}

/**
 * Chat export data
 */
export interface ChatsExportData {
  chats: ExportedChat[];
  memories?: Memory[];
}

/**
 * Roleplay template export data
 */
export interface RoleplayTemplatesExportData {
  roleplayTemplates: ExportedRoleplayTemplate[];
}

/**
 * Connection profile export data
 */
export interface ConnectionProfilesExportData {
  connectionProfiles: SanitizedConnectionProfile[];
}

/**
 * Image profile export data
 */
export interface ImageProfilesExportData {
  imageProfiles: SanitizedImageProfile[];
}

/**
 * Embedding profile export data
 */
export interface EmbeddingProfilesExportData {
  embeddingProfiles: SanitizedEmbeddingProfile[];
}

/**
 * Tags export data
 */
export interface TagsExportData {
  tags: Tag[];
}

/**
 * Union of all possible export data structures
 */
export type QuilltapExportData =
  | CharactersExportData
  | PersonasExportData
  | ChatsExportData
  | RoleplayTemplatesExportData
  | ConnectionProfilesExportData
  | ImageProfilesExportData
  | EmbeddingProfilesExportData
  | TagsExportData;

/**
 * Complete export structure with manifest and data
 *
 * This is the full structure that gets serialized to JSON and packaged
 * in the .qtap export file.
 */
export interface QuilltapExport {
  manifest: QuilltapExportManifest;
  data: QuilltapExportData;
}

// ============================================================================
// EXPORT API TYPES
// ============================================================================

/**
 * Options for creating an export
 */
export interface ExportOptions {
  /** Type of entity to export */
  type: ExportEntityType;
  /** Scope of export */
  scope: 'all' | 'selected';
  /** Entity IDs to export (required if scope is 'selected') */
  selectedIds?: string[];
  /** Whether to include related memories */
  includeMemories?: boolean;
}

/**
 * Preview information for an export operation
 * Used by the UI to show what will be exported before creation
 */
export interface ExportPreview {
  /** Type of entities to be exported */
  type: ExportEntityType;
  /** List of entities with basic info */
  entities: Array<{
    id: string;
    name: string;
  }>;
  /** Number of memories that will be included (if applicable) */
  memoryCount?: number;
}

// ============================================================================
// IMPORT TYPES
// ============================================================================

/**
 * Conflict resolution strategy when importing
 */
export type ConflictStrategy = 'skip' | 'overwrite' | 'duplicate';

/**
 * Options for importing an export
 */
export interface ImportOptions {
  /** How to handle conflicting entities */
  conflictStrategy: ConflictStrategy;
  /** Whether to import memories */
  includeMemories: boolean;
  /** Whether to import related entities (profiles, templates, etc.) */
  includeRelatedEntities: boolean;
}

/**
 * Preview of an import operation
 * Shows what will be imported before confirmation
 */
export interface ImportPreview {
  /** Type of entities in the export */
  type: ExportEntityType;
  /** Number of primary entities to import */
  entityCount: number;
  /** Number of memories to import (if applicable) */
  memoryCount?: number;
  /** Number of related entities to import */
  relatedEntityCount?: number;
  /** Entities that would conflict with existing data */
  conflicts: Array<{
    id: string;
    name: string;
    existingId: string;
    existingName: string;
  }>;
}

/**
 * Result of an import operation
 */
export interface ImportResult {
  /** Whether the import was successful */
  success: boolean;
  /** Number of entities imported */
  importedCount: number;
  /** Number of memories imported */
  memoriesImported: number;
  /** Number of related entities imported */
  relatedEntitiesImported: number;
  /** Mapping of old IDs to new IDs (for ID remapping) */
  idMapping: Record<string, string>;
  /** Any warnings that occurred during import */
  warnings: string[];
  /** Error message if import failed */
  error?: string;
}

// ============================================================================
// EXPORT UTILITY TYPES
// ============================================================================

/**
 * Memory collection result
 */
export interface MemoryCollection {
  characterMemories: Record<string, Memory[]>;
  personaMemories: Record<string, Memory[]>;
  chatMemories: Record<string, Memory[]>;
}
