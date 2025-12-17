/**
 * Backup and Restore System Types
 *
 * Defines TypeScript interfaces and types for the backup/restore system,
 * supporting full user data exports and imports with version management.
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
  FileEntry,
  MessageEvent,
  PromptTemplate,
  RoleplayTemplate,
} from '@/lib/schemas/types';

// ============================================================================
// BACKUP MANIFEST
// ============================================================================

/**
 * Metadata about a backup
 *
 * Contains version information, timestamps, and counts of all backed-up entities.
 * This manifest is included in every backup to support version-aware restoration
 * and to provide summary information for display to users.
 */
export interface BackupManifest {
  /** Backup format version (currently '1.0') */
  version: '1.0';

  /** ISO 8601 timestamp of when the backup was created */
  createdAt: string;

  /** UUID of the user who created this backup */
  userId: string;

  /** Application version at the time of backup creation (e.g., '2.0.0') */
  appVersion: string;

  /** Counts of all backed-up entities for validation and progress tracking */
  counts: {
    /** Number of Character entities */
    characters: number;
    /** Number of Persona entities */
    personas: number;
    /** Number of Chat entities */
    chats: number;
    /** Total number of messages across all chats */
    messages: number;
    /** Number of Tag entities */
    tags: number;
    /** Number of ConnectionProfile entities (includes API keys) */
    connectionProfiles: number;
    /** Number of ImageProfile entities */
    imageProfiles: number;
    /** Number of EmbeddingProfile entities */
    embeddingProfiles: number;
    /** Number of Memory entities */
    memories: number;
    /** Number of FileEntry entities (file metadata, not the actual files) */
    files: number;
    /** Number of PromptTemplate entities (user-created only) */
    promptTemplates: number;
    /** Number of RoleplayTemplate entities (user-created only) */
    roleplayTemplates: number;
  };
}

// ============================================================================
// BACKUP DATA
// ============================================================================

/**
 * Complete backup data structure
 *
 * Contains all user data in a structured format suitable for JSON serialization
 * and S3 storage. The manifest provides version information for restoration logic.
 * All arrays are present but may be empty if no entities of that type exist.
 */
export interface BackupData {
  /** Backup manifest with version and metadata */
  manifest: BackupManifest;

  /** Array of Character entities */
  characters: Character[];

  /** Array of Persona entities */
  personas: Persona[];

  /** Array of Chat entities with all messages included */
  chats: ChatWithMessages[];

  /** Array of Tag entities */
  tags: Tag[];

  /** Array of ConnectionProfile entities */
  connectionProfiles: ConnectionProfile[];

  /** Array of ImageProfile entities */
  imageProfiles: ImageProfile[];

  /** Array of EmbeddingProfile entities */
  embeddingProfiles: EmbeddingProfile[];

  /** Array of Memory entities */
  memories: Memory[];

  /** Array of FileEntry entities (metadata only, not actual file contents) */
  files: FileEntry[];

  /** Array of user-created PromptTemplate entities (excludes built-in templates) */
  promptTemplates: PromptTemplate[];

  /** Array of user-created RoleplayTemplate entities (excludes built-in templates) */
  roleplayTemplates: RoleplayTemplate[];
}

// ============================================================================
// CHAT WITH MESSAGES
// ============================================================================

/**
 * Chat metadata extended with message history
 *
 * This combines the ChatMetadata with an array of all MessageEvent objects
 * that belong to the chat. Used primarily during backup/restore operations.
 */
export interface ChatWithMessages extends ChatMetadata {
  /** Array of message events for this chat in chronological order */
  messages: MessageEvent[];
}

// ============================================================================
// RESTORE OPTIONS
// ============================================================================

/**
 * Configuration options for restore operations
 *
 * Specifies how the backup data should be imported into the system.
 * Different modes support different use cases (complete replacement vs. new account).
 */
export interface RestoreOptions {
  /**
   * Restore mode:
   * - 'replace': Clear existing user data and replace with backup (destructive)
   * - 'new-account': Create a new account and import backup data into it
   */
  mode: 'replace' | 'new-account';

  /** UUID of the target user for restoration */
  targetUserId: string;
}

// ============================================================================
// RESTORE SUMMARY
// ============================================================================

/**
 * Summary of a completed restore operation
 *
 * Provides detailed information about what was restored, including counts
 * of each entity type and any warnings that occurred during the process.
 * Used to inform the user about the restore result.
 */
export interface RestoreSummary {
  /** Number of Character entities restored */
  characters: number;

  /** Number of Persona entities restored */
  personas: number;

  /** Number of Chat entities restored */
  chats: number;

  /** Total number of messages restored across all chats */
  messages: number;

  /** Number of Tag entities restored */
  tags: number;

  /** Number of FileEntry entities restored (metadata only) */
  files: number;

  /** Number of Memory entities restored */
  memories: number;

  /** Counts for different types of profiles */
  profiles: {
    /** Number of ConnectionProfile entities restored */
    connection: number;
    /** Number of ImageProfile entities restored */
    image: number;
    /** Number of EmbeddingProfile entities restored */
    embedding: number;
  };

  /** Counts for template types */
  templates: {
    /** Number of PromptTemplate entities restored */
    prompt: number;
    /** Number of RoleplayTemplate entities restored */
    roleplay: number;
  };

  /**
   * Array of warning messages for issues that occurred during restore
   * (e.g., skipped duplicate tags, missing referenced profiles)
   * Warnings do not prevent successful restoration
   */
  warnings: string[];
}

// ============================================================================
// BACKUP INFO
// ============================================================================

/**
 * Information about a backup stored in S3
 *
 * Used when listing available backups for display in the UI.
 * Provides essential metadata without downloading the full backup file.
 */
export interface BackupInfo {
  /** S3 object key (full path) for this backup file */
  key: string;

  /** User-friendly filename (e.g., 'backup-2025-12-07-14-30-00.json') */
  filename: string;

  /** Date when the backup was created */
  createdAt: Date;

  /** File size in bytes */
  size: number;
}
