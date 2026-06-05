/**
 * Document UI tool handlers: doc_open_document, doc_close_document, doc_focus.
 *
 * These handlers control the split-panel editor pane in the Salon — opening,
 * closing, and focusing documents in Document Mode. They write to the
 * chat_documents table and return structured responses the frontend interprets
 * to drive the UI.
 *
 * @module tools/handlers/doc-edit/document-ui-handlers
 */

import path from 'path';
import fs from 'fs/promises';
import {
  resolveDocEditPath,
  PathResolutionError,
  type DocEditScope,
} from '@/lib/doc-edit';
import type { DocOpenDocumentInput, DocOpenDocumentOutput } from '../../doc-open-document-tool';
import type { DocCloseDocumentInput, DocCloseDocumentOutput } from '../../doc-close-document-tool';
import type { DocFocusInput } from '../../doc-focus-tool';
import { getRepositories } from '@/lib/repositories/factory';
import {
  postLibrarianOpenAnnouncement,
} from '@/lib/services/librarian-notifications/writer';
import { databaseDocumentExists } from '@/lib/mount-index/database-store';
import {
  logger,
  type DocEditToolContext,
  buildReadResolutionContext,
} from './shared';

/**
 * Handle doc_open_document: open a document in the split-panel editor.
 * This is a UI tool — it writes to the chat_documents table and returns
 * a structured response that the frontend interprets to open the editor pane.
 */
export async function handleOpenDocument(
  input: DocOpenDocumentInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: unknown; error?: string; formattedText?: string }> {
  const repos = getRepositories();
  const scope = (input.scope || 'project') as 'document_store' | 'project' | 'general';
  const mode = input.mode || 'split';
  let filePath = input.path;
  let displayTitle = input.title || 'Untitled document';
  let isNew = false;
  let mtime: number | undefined;

  if (filePath) {
    // Opening an existing file — resolve the path to verify it exists.
    // Treated as a read so peer vaults are reachable when the chat's
    // cross-character read flag is enabled.
    try {
      const resolved = await resolveDocEditPath(scope, filePath, await buildReadResolutionContext({ mount_point: input.mount_point }, context));
      if (resolved.mountType === 'database' && resolved.mountPointId) {
        const exists = await databaseDocumentExists(resolved.mountPointId, resolved.relativePath);
        if (!exists) throw new Error(`File not found: ${filePath}`);
        mtime = Date.now();
      } else {
        const stat = await fs.stat(resolved.absolutePath);
        mtime = stat.mtimeMs;
      }
      // Use filename as display title if not provided
      if (!input.title) {
        displayTitle = path.basename(filePath);
      }
    } catch (error) {
      if (error instanceof PathResolutionError) {
        return { success: false, error: error.message };
      }
      return { success: false, error: `File not found: ${filePath}` };
    }
  } else {
    // Creating a new blank document
    isNew = true;
    const uuid = crypto.randomUUID();
    filePath = `${uuid}.md`;

    // Determine save location based on project context
    const targetScope = context.projectId ? 'project' : 'general';
    try {
      const resolved = await resolveDocEditPath(targetScope as DocEditScope, filePath, { projectId: context.projectId });
      // Create the blank file
      await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
      await fs.writeFile(resolved.absolutePath, '', 'utf-8');
      const stat = await fs.stat(resolved.absolutePath);
      mtime = stat.mtimeMs;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to create blank document: ${errorMsg}` };
    }
  }

  // Update the chat_documents table
  try {
    await repos.chatDocuments.openDocument(context.chatId, {
      filePath,
      scope,
      mountPoint: input.mount_point,
      displayTitle,
    });

    // Update the chat's document mode
    await repos.chats.update(context.chatId, {
      documentMode: mode,
    } as Record<string, unknown>);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to persist document association', {
      chatId: context.chatId,
      filePath,
      error: errorMsg,
    });
    return { success: false, error: `Failed to open document: ${errorMsg}` };
  }

  const result: DocOpenDocumentOutput = {
    success: true,
    filePath,
    scope,
    mountPoint: input.mount_point,
    displayTitle,
    mode,
    isNew,
    mtime,
  };

  logger.info('Opened document in Document Mode', {
    chatId: context.chatId,
    filePath,
    scope,
    mode,
    isNew,
  });

  // Post a Librarian announcement attributing the open to the invoking character, so everyone
  // in the chat sees who opened the document. Errors never propagate — they're swallowed inside
  // the writer — but if we can't resolve a character name we fall back to user attribution.
  let characterName: string | null = null;
  if (context.characterId) {
    try {
      const character = await repos.characters.findById(context.characterId);
      if (character?.name) {
        characterName = character.name;
      }
    } catch (error) {
    }
  }

  await postLibrarianOpenAnnouncement({
    chatId: context.chatId,
    displayTitle,
    filePath,
    scope,
    mountPoint: input.mount_point,
    isNew,
    origin: characterName
      ? { kind: 'opened-by-character', characterName }
      : { kind: 'opened-by-user' },
  });

  return {
    success: true,
    result,
    formattedText: isNew
      ? `Created and opened new document "${displayTitle}" in ${mode} mode.`
      : `Opened document "${displayTitle}" (${filePath}) in ${mode} mode.`,
  };
}

/**
 * Handle doc_close_document: close the document editor pane.
 * Returns to normal chat layout. Document state is cached for the session.
 */
export async function handleCloseDocument(
  input: DocCloseDocumentInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: unknown; error?: string; formattedText?: string }> {
  const repos = getRepositories();

  try {
    const closed = await repos.chatDocuments.closeDocument(context.chatId);

    // Update the chat's document mode back to normal
    await repos.chats.update(context.chatId, {
      documentMode: 'normal',
    } as Record<string, unknown>);

    if (!closed) {
      return {
        success: true,
        result: { success: true, message: 'No document was open.' },
        formattedText: 'No document was open to close.',
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to close document', {
      chatId: context.chatId,
      error: errorMsg,
    });
    return { success: false, error: `Failed to close document: ${errorMsg}` };
  }

  const message = input.reason
    ? `Closed the document. ${input.reason}`
    : 'Closed the document and returned to chat view.';

  const result: DocCloseDocumentOutput = {
    success: true,
    message,
  };

  logger.info('Closed document in Document Mode', {
    chatId: context.chatId,
    reason: input.reason,
  });

  return {
    success: true,
    result,
    formattedText: message,
  };
}

/**
 * Handle doc_focus: focus the user's attention on a location in the open document.
 * Scrolls to anchor, highlight, or line number. Can also clear focus.
 */
export async function handleDocFocus(
  input: DocFocusInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: unknown; error?: string; formattedText?: string }> {

  // If clear_focus is true, return immediately
  if (input.clear_focus) {
    return { success: true, result: { success: true, clear_focus: true } };
  }

  // Query the database to check if a document is open
  const repos = getRepositories();
  const activeDoc = await repos.chatDocuments.findActiveForChat(context.chatId);

  // If no active document, return error
  if (!activeDoc) {
    return { success: false, error: 'No document is open in Document Mode.' };
  }

  // Otherwise return success with the params passed through
  return {
    success: true,
    result: {
      success: true,
      anchor: input.anchor,
      highlight: input.highlight,
      line: input.line,
    },
  };
}
