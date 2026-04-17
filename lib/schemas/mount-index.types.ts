/**
 * Document Mount Index Type Definitions
 *
 * Schemas for Project Scriptorium Phase 3.2 document mount points —
 * external document directories that can be indexed and searched
 * alongside conversation data. These are NOT the old file storage
 * mount points that were dropped in v2.9.0.
 *
 * @module schemas/mount-index.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// DOCUMENT MOUNT POINT
// ============================================================================

export const DocMountPointSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1),           // Display name for the mount point
  // Absolute filesystem path. Required for filesystem/obsidian; empty string for database-backed stores.
  basePath: z.string().default(''),
  mountType: z.enum(['filesystem', 'obsidian', 'database']).default('filesystem'),
  includePatterns: z.array(z.string()).default(['*.md', '*.txt', '*.pdf', '*.docx']),
  excludePatterns: z.array(z.string()).default(['.git', 'node_modules', '.obsidian', '.trash']),
  enabled: z.boolean().default(true),
  lastScannedAt: TimestampSchema.nullable().optional(),
  scanStatus: z.enum(['idle', 'scanning', 'error']).default('idle'),
  lastScanError: z.string().nullable().optional(),
  // Backend-storage conversion state (filesystem ↔ database). 'converting' means
  // filesystem→database in flight; 'deconverting' means database→filesystem in
  // flight. Distinct from the file-level doc_mount_files.conversionStatus,
  // which tracks pdf/docx→text extraction.
  conversionStatus: z.enum(['idle', 'converting', 'deconverting', 'error']).default('idle'),
  conversionError: z.string().nullable().optional(),
  fileCount: z.number().int().default(0),   // Cached count of active files
  chunkCount: z.number().int().default(0),  // Cached count of chunks
  totalSizeBytes: z.number().int().default(0),  // Cached total size of all files in bytes
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountPoint = z.infer<typeof DocMountPointSchema>;
export type DocMountPointType = DocMountPoint['mountType'];

// ============================================================================
// DOCUMENT MOUNT FILE
// ============================================================================

export const DocMountFileSchema = z.object({
  id: UUIDSchema,
  mountPointId: UUIDSchema,
  relativePath: z.string().min(1),   // Relative to basePath (or virtual path for database-backed stores)
  fileName: z.string().min(1),       // Just the filename
  fileType: z.enum(['pdf', 'docx', 'markdown', 'txt']),
  sha256: z.string().length(64),     // Hex digest
  fileSizeBytes: z.number().int().min(0),
  lastModified: TimestampSchema,     // File's mtime (or DB write time for database source)
  // Where the file content lives: on-disk ('filesystem') or inside doc_mount_documents ('database').
  source: z.enum(['filesystem', 'database']).default('filesystem'),
  conversionStatus: z.enum(['pending', 'converted', 'failed', 'skipped']).default('pending'),
  conversionError: z.string().nullable().optional(),
  plainTextLength: z.number().int().nullable().optional(),
  chunkCount: z.number().int().default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountFile = z.infer<typeof DocMountFileSchema>;

// ============================================================================
// DOCUMENT MOUNT CHUNK
// ============================================================================

export const DocMountChunkSchema = z.object({
  id: UUIDSchema,
  fileId: UUIDSchema,
  mountPointId: UUIDSchema,          // Denormalized for query efficiency
  chunkIndex: z.number().int().min(0),
  content: z.string(),
  tokenCount: z.number().int().min(0),
  headingContext: z.string().nullable().optional(),  // What section heading this chunk is under
  embedding: z.array(z.number()).nullable().optional(),  // Float32 BLOB
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountChunk = z.infer<typeof DocMountChunkSchema>;

// ============================================================================
// PROJECT ↔ DOCUMENT MOUNT LINK
// ============================================================================

export const ProjectDocMountLinkSchema = z.object({
  id: UUIDSchema,
  projectId: UUIDSchema,
  mountPointId: UUIDSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ProjectDocMountLink = z.infer<typeof ProjectDocMountLinkSchema>;

// ============================================================================
// DOCUMENT MOUNT DOCUMENT (database-backed store content)
// ============================================================================

// Text documents whose bytes live entirely inside quilltap-mount-index.db.
// Only materialised for mount points with mountType === 'database'. Each row
// is mirrored in doc_mount_files (source === 'database') so the scanner,
// search, and embedding pipelines can treat it like any other indexed file.
export const DocMountDocumentSchema = z.object({
  id: UUIDSchema,
  mountPointId: UUIDSchema,
  relativePath: z.string().min(1),
  fileName: z.string().min(1),
  fileType: z.enum(['markdown', 'txt']),
  content: z.string(),
  contentSha256: z.string().length(64),
  plainTextLength: z.number().int().min(0),
  lastModified: TimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountDocument = z.infer<typeof DocMountDocumentSchema>;

// ============================================================================
// DOCUMENT MOUNT BLOB (binary assets — images, etc.)
// ============================================================================

// Metadata for blobs stored in quilltap-mount-index.db. The raw bytes live in
// the `data` BLOB column of the same SQLite row but are deliberately absent
// from this Zod schema: the blob repository exposes dedicated read/write
// methods so we never accidentally load megabytes of binary into generic
// SQLiteCollection serialisation paths.
export const DocMountBlobMetadataSchema = z.object({
  id: UUIDSchema,
  mountPointId: UUIDSchema,
  relativePath: z.string().min(1),      // e.g. 'images/avatar.webp'
  originalFileName: z.string().min(1),  // As uploaded by the user
  originalMimeType: z.string().min(1),  // e.g. 'image/png'
  storedMimeType: z.string().min(1),    // Usually 'image/webp' after transcode
  sizeBytes: z.number().int().min(0),
  sha256: z.string().length(64),
  description: z.string().default(''),  // User-supplied description / embedding transcript
  descriptionUpdatedAt: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountBlobMetadata = z.infer<typeof DocMountBlobMetadataSchema>;
