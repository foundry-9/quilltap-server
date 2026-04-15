/**
 * Chat Document Type Definitions
 *
 * Schemas for Scriptorium Phase 3.5 Document Mode —
 * tracks which documents are open in each chat's split-panel editor.
 *
 * @module schemas/chat-document.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// CHAT DOCUMENT
// ============================================================================

/** Valid scopes for document file resolution */
export const DocScopeSchema = z.enum(['project', 'document_store', 'general']);
export type DocScope = z.infer<typeof DocScopeSchema>;

export const ChatDocumentSchema = z.object({
  id: UUIDSchema,
  chatId: UUIDSchema,
  filePath: z.string(),
  scope: DocScopeSchema.default('project'),
  mountPoint: z.string().nullable().optional(),
  displayTitle: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatDocument = z.infer<typeof ChatDocumentSchema>;

// Input type for creating chat document associations
export const ChatDocumentInputSchema = ChatDocumentSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ChatDocumentInput = z.infer<typeof ChatDocumentInputSchema>;

// ============================================================================
// DOCUMENT MODE (on chats table)
// ============================================================================

/** Valid layout modes for document mode */
export const DocumentModeSchema = z.enum(['normal', 'split', 'focus']);
export type DocumentMode = z.infer<typeof DocumentModeSchema>;
