/**
 * Help Document Type Definitions
 *
 * Contains schemas for help documents stored in the database
 * for embedding and semantic search at runtime.
 *
 * @module schemas/help-doc.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// HELP DOCUMENT
// ============================================================================

export const HelpDocSchema = z.object({
  id: UUIDSchema,
  title: z.string(),
  path: z.string(),                                   // Relative path, e.g. "help/aurora.md"
  url: z.string(),                                    // URL route the doc is associated with
  content: z.string(),                                // Full markdown content, frontmatter stripped
  contentHash: z.string(),                            // SHA-256 hash of content for change detection
  embedding: z.array(z.number()).nullable().optional(), // Embedding vector, Float32 BLOB in DB
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type HelpDoc = z.infer<typeof HelpDocSchema>;

export type HelpDocInput = Omit<HelpDoc, 'id' | 'createdAt' | 'updatedAt'>;
