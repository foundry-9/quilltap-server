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
  basePath: z.string().min(1),       // Absolute filesystem path
  mountType: z.enum(['filesystem', 'obsidian']).default('filesystem'),
  includePatterns: z.array(z.string()).default(['*.md', '*.txt', '*.pdf', '*.docx']),
  excludePatterns: z.array(z.string()).default(['.git', 'node_modules', '.obsidian', '.trash']),
  enabled: z.boolean().default(true),
  lastScannedAt: TimestampSchema.nullable().optional(),
  scanStatus: z.enum(['idle', 'scanning', 'error']).default('idle'),
  lastScanError: z.string().nullable().optional(),
  fileCount: z.number().int().default(0),   // Cached count of active files
  chunkCount: z.number().int().default(0),  // Cached count of chunks
  totalSizeBytes: z.number().int().default(0),  // Cached total size of all files in bytes
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type DocMountPoint = z.infer<typeof DocMountPointSchema>;

// ============================================================================
// DOCUMENT MOUNT FILE
// ============================================================================

export const DocMountFileSchema = z.object({
  id: UUIDSchema,
  mountPointId: UUIDSchema,
  relativePath: z.string().min(1),   // Relative to basePath
  fileName: z.string().min(1),       // Just the filename
  fileType: z.enum(['pdf', 'docx', 'markdown', 'txt']),
  sha256: z.string().length(64),     // Hex digest
  fileSizeBytes: z.number().int().min(0),
  lastModified: TimestampSchema,     // File's mtime
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
