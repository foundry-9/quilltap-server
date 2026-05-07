/**
 * Database Abstraction Layer - Chat Documents Repository
 *
 * Backend-agnostic repository for ChatDocument entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles document associations for Scriptorium Phase 3.5 Document Mode —
 * tracks which documents are open alongside each chat in the split-panel editor.
 * Closed documents are kept as inactive records for quick-reopen.
 */

import {
  ChatDocument,
  ChatDocumentSchema,
} from '@/lib/schemas/chat-document.types';
import { AbstractBaseRepository } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter } from '../interfaces';

/**
 * Chat Documents Repository
 * Implements CRUD operations for chat-document associations.
 * Phase 3.5 enforces one active document per chat; the schema
 * supports future multi-document tabs without migration.
 * Closed documents are kept as inactive for quick-reopen history.
 */
export class ChatDocumentsRepository extends AbstractBaseRepository<ChatDocument> {
  constructor() {
    super('chat_documents', ChatDocumentSchema);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  async findById(id: string): Promise<ChatDocument | null> {
    return this._findById(id);
  }

  async findAll(): Promise<ChatDocument[]> {
    return this._findAll();
  }

  async create(
    data: Omit<ChatDocument, 'id' | 'createdAt' | 'updatedAt'>,
    options?: import('./base.repository').CreateOptions
  ): Promise<ChatDocument> {
    return this._create(data, options);
  }

  async update(id: string, data: Partial<ChatDocument>): Promise<ChatDocument | null> {
    return this._update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id);
  }

  // ============================================================================
  // Custom query methods
  // ============================================================================

  /**
   * Find the active document for a chat (Phase 3.5: at most one)
   */
  async findActiveForChat(chatId: string): Promise<ChatDocument | null> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter({
          chatId,
          isActive: true,
        } as TypedQueryFilter<ChatDocument>);
        return results.length > 0 ? results[0] : null;
      },
      'Error finding active document for chat',
      { chatId },
      null
    );
  }

  /**
   * Find all documents associated with a chat (including inactive)
   */
  async findByChatId(chatId: string): Promise<ChatDocument[]> {
    return this.safeQuery(
      async () => {
        return this.findByFilter({ chatId } as TypedQueryFilter<ChatDocument>);
      },
      'Error finding documents by chat ID',
      { chatId },
      []
    );
  }

  /**
   * Find recent inactive documents for a chat, sorted by most recently updated.
   * Used by the document picker for quick-reopen options.
   */
  async findRecentForChat(chatId: string, limit = 5): Promise<ChatDocument[]> {
    return this.safeQuery(
      async () => {
        const allDocs = await this.findByFilter({ chatId } as TypedQueryFilter<ChatDocument>);
        return allDocs
          .filter(doc => !doc.isActive)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, limit);
      },
      'Error finding recent documents for chat',
      { chatId },
      []
    );
  }

  /**
   * Open a document for a chat. If a document is already open,
   * the existing one is deactivated (kept for history).
   * If the requested document was previously opened, reactivates it.
   * Auto-saves are handled by the caller before this method is invoked.
   */
  async openDocument(chatId: string, data: {
    filePath: string;
    scope: string;
    mountPoint?: string | null;
    displayTitle?: string | null;
  }): Promise<ChatDocument> {
    // Deactivate any currently active document for this chat
    const currentDoc = await this.findActiveForChat(chatId);
    if (currentDoc) {
      await this.update(currentDoc.id, { isActive: false });
    }

    // Check if this document was previously opened (reactivate instead of duplicate)
    const allDocs = await this.findByChatId(chatId);
    const existingDoc = allDocs.find(doc =>
      doc.filePath === data.filePath &&
      doc.scope === data.scope &&
      (doc.mountPoint || null) === (data.mountPoint || null)
    );

    if (existingDoc) {
      const updated = await this.update(existingDoc.id, {
        isActive: true,
        displayTitle: data.displayTitle ?? existingDoc.displayTitle,
      });

      return updated || existingDoc;
    }

    // Create a new document association
    const doc = await this.create({
      chatId,
      filePath: data.filePath,
      scope: data.scope as 'project' | 'document_store' | 'general',
      mountPoint: data.mountPoint ?? null,
      displayTitle: data.displayTitle ?? null,
      isActive: true,
    });

    return doc;
  }

  /**
   * Close the active document for a chat.
   * Deactivates instead of deleting, preserving history for quick-reopen.
   */
  async closeDocument(chatId: string): Promise<boolean> {
    const currentDoc = await this.findActiveForChat(chatId);
    if (!currentDoc) {
      return false;
    }

    await this.update(currentDoc.id, { isActive: false });

    return true;
  }

  /**
   * Rewrite every chat_documents row whose filePath exactly matches `oldPath`
   * to carry `newPath` instead. Used by startup migrations when an overlay or
   * scaffold file is renamed, so split-panel editor state from old sessions
   * does not 404 on next chat open. Returns the number of rows updated.
   */
  async renameFilePath(oldPath: string, newPath: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const stale = await this.findByFilter({
          filePath: oldPath,
        } as TypedQueryFilter<ChatDocument>);
        let count = 0;
        for (const row of stale) {
          const updated = await this.update(row.id, { filePath: newPath });
          if (updated) count++;
        }
        return count;
      },
      'Error renaming chat document filePath',
      { oldPath, newPath },
      0,
    );
  }

  /**
   * Delete all document associations for a chat (cascade cleanup)
   */
  async deleteByChatId(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => {
        const docs = await this.findByChatId(chatId);
        let count = 0;
        for (const doc of docs) {
          const deleted = await this.delete(doc.id);
          if (deleted) count++;
        }
        return count;
      },
      'Error deleting documents by chat ID',
      { chatId },
      0
    );
  }
}
