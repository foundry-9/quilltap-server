/**
 * Database Abstraction Layer - Chat Documents Repository
 *
 * Backend-agnostic repository for ChatDocument entities.
 * Works with SQLite through the database abstraction layer.
 *
 * Handles document associations for Scriptorium Phase 3.5 Document Mode —
 * tracks which documents are open alongside each chat in the split-panel editor.
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
   * Open a document for a chat. If a document is already open,
   * the existing one is deactivated and the new one is created.
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
      await this.delete(currentDoc.id);
      logger.debug('Deactivated previous document for chat', {
        context: 'ChatDocumentsRepository.openDocument',
        chatId,
        previousDocId: currentDoc.id,
        previousFilePath: currentDoc.filePath,
      });
    }

    // Create the new document association
    const doc = await this.create({
      chatId,
      filePath: data.filePath,
      scope: data.scope as 'project' | 'document_store' | 'general',
      mountPoint: data.mountPoint ?? null,
      displayTitle: data.displayTitle ?? null,
      isActive: true,
    });

    logger.debug('Opened document for chat', {
      context: 'ChatDocumentsRepository.openDocument',
      chatId,
      docId: doc.id,
      filePath: data.filePath,
      scope: data.scope,
    });

    return doc;
  }

  /**
   * Close the active document for a chat.
   * Removes the association entirely.
   */
  async closeDocument(chatId: string): Promise<boolean> {
    const currentDoc = await this.findActiveForChat(chatId);
    if (!currentDoc) {
      logger.debug('No active document to close for chat', {
        context: 'ChatDocumentsRepository.closeDocument',
        chatId,
      });
      return false;
    }

    await this.delete(currentDoc.id);

    logger.debug('Closed document for chat', {
      context: 'ChatDocumentsRepository.closeDocument',
      chatId,
      docId: currentDoc.id,
      filePath: currentDoc.filePath,
    });

    return true;
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
