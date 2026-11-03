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
import { projectRosterAdmits } from '@/lib/projects/roster-access';
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
  documentHiddenFromCharacters,
  toLibrarianOpenKind,
} from '@/lib/services/librarian-notifications/writer';
import { ensureDocument, readDocument, viewTargetFor } from '@/lib/documents/core';
import type { ChatDocument } from '@/lib/schemas/chat-document.types';
import {
  logger,
  type DocEditToolContext,
  applyQtapUriToInput,
  buildReadResolutionContext,
  uriForResolvedPath,
  assertCharacterMayRead,
  resolveActorOrigin,
  publishedMountPoint,
} from './shared';

/**
 * Resolve which open document a per-document UI tool (doc_focus / doc_close)
 * targets. With several documents open at once, the caller names one by file
 * path (optionally narrowed by scope / mount_point); when no path is given we
 * default to the most recently opened document. Returns null when nothing is
 * open or the named document isn't currently open.
 */
async function resolveOpenDocTarget(
  chatId: string,
  selector: { path?: string; scope?: string; mount_point?: string },
): Promise<ChatDocument | null> {
  const repos = getRepositories();
  const open = await repos.chatDocuments.findOpenForChat(chatId);
  if (open.length === 0) return null;
  if (!selector.path) {
    // findOpenForChat is oldest-first, so the last entry is the newest open.
    return open[open.length - 1];
  }
  const match = open.find(
    (d) =>
      d.filePath === selector.path &&
      (selector.scope === undefined || d.scope === selector.scope) &&
      (selector.mount_point === undefined || (d.mountPoint ?? undefined) === selector.mount_point),
  );
  return match ?? null;
}

/**
 * Handle doc_open_document: open a document in the split-panel editor.
 * This is a UI tool — it writes to the chat_documents table and returns
 * a structured response that the frontend interprets to open the editor pane.
 */
export async function handleOpenDocument(
  rawInput: DocOpenDocumentInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: unknown; error?: string; formattedText?: string }> {
  const input = applyQtapUriToInput(rawInput);
  const repos = getRepositories();
  const requestedScope = (input.scope || 'project') as 'document_store' | 'project' | 'general';
  // What the chat_documents row, the result and the announcement name: the
  // scope the file actually lives in. For an existing file that is the one
  // asked for; a new blank document picks its own (#137).
  let scope = requestedScope;
  const mode = input.mode || 'split';
  let filePath = input.path;
  let displayTitle = input.title || 'Untitled document';
  let isNew = false;
  let mtime: number | undefined;
  let docUri: string | undefined;
  // A character_read:false document must not be announced to characters. The
  // read gate already blocks characters from opening one; this covers the
  // operator-override path that bypasses the gate.
  let hiddenFromCharacters = false;
  // What the chat_documents row, the result and the announcement name — the
  // resolved store, never a reader-relative `self` (bug 256).
  let storeName = input.mount_point;

  if (filePath) {
    // Opening an existing file — resolve the path to verify it exists.
    // Treated as a read so peer vaults are reachable when the chat's
    // cross-character read flag is enabled.
    try {
      const resolved = await resolveDocEditPath(requestedScope, filePath, await buildReadResolutionContext({ mount_point: input.mount_point }, context));
      // character_read:false → not-found for characters (operator unaffected).
      await assertCharacterMayRead(resolved, context);
      hiddenFromCharacters = await documentHiddenFromCharacters(resolved.mountPointId, resolved.relativePath);
      storeName = publishedMountPoint(resolved, input.mount_point);
      docUri = await uriForResolvedPath(resolved);
      // Open what the operator's Document Mode would open: a file it only
      // views (an image, a PDF) by its view target, anything else — an
      // uploaded text blob included — by reading it through the core.
      const viewer = await viewTargetFor(resolved);
      if (viewer) {
        mtime = Date.parse(viewer.updatedAt);
      } else {
        ({ mtime } = await readDocument(resolved));
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
    // Lands in the project store only when the roster admits the character;
    // otherwise it falls back to Quilltap General.
    const targetScope =
      context.projectId && (await projectRosterAdmits(context.projectId, context.characterId))
        ? 'project'
        : 'general';
    try {
      const resolved = await resolveDocEditPath(targetScope as DocEditScope, filePath, {
        projectId: context.projectId,
        characterId: context.characterId,
      });
      // Create the blank file through the core's writer — a database store
      // gets a document row and every store its refresh, never raw `fs`.
      const ensured = await ensureDocument(resolved);
      if (!ensured.created) {
        return { success: false, error: `Failed to create blank document: ${filePath} already exists` };
      }
      mtime = ensured.mtime;
      docUri = await uriForResolvedPath(resolved);
      // Record where it was made, not where the call asked: the caller's
      // scope and mount_point play no part in choosing the location (#137).
      scope = targetScope;
      storeName = publishedMountPoint(resolved, undefined);
      logger.debug('doc_open_document: created a blank document', {
        chatId: context.chatId,
        filePath,
        requestedScope,
        scope,
        mountPoint: storeName,
      });
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
      mountPoint: storeName,
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
    uri: docUri,
    scope,
    mountPoint: storeName,
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
  // the writer — and `resolveActorOrigin` falls back to user attribution when it can't name a
  // character.
  await postLibrarianOpenAnnouncement({
    chatId: context.chatId,
    displayTitle,
    filePath,
    scope,
    mountPoint: storeName,
    isNew,
    origin: toLibrarianOpenKind(await resolveActorOrigin(context)),
    hiddenFromCharacters,
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
    // Resolve which open document to close (named by path, or the most recently
    // opened when omitted), then recompute documentMode from what remains so it
    // only returns to 'normal' once the last document closes.
    const target = await resolveOpenDocTarget(context.chatId, {
      path: input.path,
      scope: input.scope,
      mount_point: input.mount_point,
    });

    if (!target) {
      // Nothing open (or nothing matched) — make sure the flag is consistent.
      await repos.chats.update(context.chatId, {
        documentMode: 'normal',
      } as Record<string, unknown>);
      return {
        success: true,
        result: { success: true, message: 'No document was open.' },
        formattedText: input.path
          ? `No open document matches "${input.path}".`
          : 'No document was open to close.',
      };
    }

    await repos.chatDocuments.closeDocumentById(context.chatId, target.id);

    const remaining = await repos.chatDocuments.findOpenForChat(context.chatId);
    if (remaining.length === 0) {
      await repos.chats.update(context.chatId, {
        documentMode: 'normal',
      } as Record<string, unknown>);
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
  // Resolve which open document this focus targets so the client scrolls the
  // correct pane when several are open. Pass the identity through in the result.
  const target = await resolveOpenDocTarget(context.chatId, {
    path: input.path,
    scope: input.scope,
    mount_point: input.mount_point,
  });

  const targetIdentity = target
    ? {
        chatDocumentId: target.id,
        filePath: target.filePath,
        scope: target.scope,
        mountPoint: target.mountPoint,
      }
    : {};

  // If clear_focus is true, return immediately (best-effort identity so the
  // matching pane clears; harmless if nothing is open).
  if (input.clear_focus) {
    return { success: true, result: { success: true, clear_focus: true, ...targetIdentity } };
  }

  // If no document matches, return error.
  if (!target) {
    return {
      success: false,
      error: input.path
        ? `No open document matches "${input.path}".`
        : 'No document is open in Document Mode.',
    };
  }

  // Otherwise return success with the params passed through.
  return {
    success: true,
    result: {
      success: true,
      ...targetIdentity,
      anchor: input.anchor,
      highlight: input.highlight,
      line: input.line,
    },
  };
}
