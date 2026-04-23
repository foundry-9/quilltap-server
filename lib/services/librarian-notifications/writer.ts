/**
 * Writer for Document Mode chat notifications (the Librarian).
 *
 * When a document is opened in Document Mode or saved from the editor, this
 * helper injects a synthetic ASSISTANT-role chat message announcing the event
 * on behalf of the Librarian. Characters see the announcement in their recent
 * history and know the document is available (and who opened it), without the
 * user losing their turn to the LLM.
 *
 * Three kinds of announcements:
 *   - 'opened-by-user'       → user-initiated Document Mode open
 *   - 'opened-by-character'  → character-initiated via the `doc_open_document` tool
 *   - 'saved'                → user autosave/manual-save from the editor (includes unified diff)
 *
 * Errors never propagate — document operations must never fail because an
 * announcement couldn't be written.
 */

import { randomUUID } from 'node:crypto';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';
import type { MessageEvent } from '@/lib/schemas/types';

export type LibrarianOpenKind =
  | { kind: 'opened-by-user' }
  | { kind: 'opened-by-character'; characterName: string };

export interface LibrarianOpenAnnouncement {
  chatId: string;
  displayTitle: string;
  filePath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  isNew: boolean;
  origin: LibrarianOpenKind;
}

export interface LibrarianSaveAnnouncement {
  chatId: string;
  /** Pre-formatted diff content (from formatAutosaveNotification) — caller owns the diff */
  diffContent: string;
}

function scopeLabel(scope: 'project' | 'document_store' | 'general', mountPoint?: string | null): string {
  if (scope === 'document_store' && mountPoint) {
    return `the document store "${mountPoint}"`;
  }
  if (scope === 'project') {
    return 'the project library';
  }
  return 'the general library';
}

function requesterLabel(origin: LibrarianOpenKind): string {
  return origin.kind === 'opened-by-user'
    ? "the user's request"
    : `${origin.characterName}'s request`;
}

export function buildOpenContent(params: LibrarianOpenAnnouncement): string {
  const { displayTitle, filePath, scope, mountPoint, isNew, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = requesterLabel(origin);
  const pathDetails = `path: "${filePath}", scope: "${scope}"${mountPoint ? `, mount_point: "${mountPoint}"` : ''}`;

  if (isNew) {
    return `The Librarian has laid out a fresh, blank page titled "${displayTitle}" upon the table at ${who}. You may use doc_read_file and the other doc_* editing tools to read or amend it (${pathDetails}).`;
  }
  return `The Librarian has set out "${displayTitle}" from ${where} at ${who}. You may use doc_read_file and the other doc_* editing tools to consult or revise it (${pathDetails}).`;
}

export function buildSaveContent(diffContent: string): string {
  // diffContent is the pre-formatted "I've made changes to …\n```diff…```" from formatAutosaveNotification.
  // Strip the leading "I've made changes to" phrasing and re-attribute to the Librarian so the LLM
  // doesn't think the user spoke a turn.
  const rephrased = diffContent.replace(/^I've made changes to (".+?"):/, 'The Librarian has filed the following alterations to $1:');
  if (rephrased === diffContent) {
    // Fallback in case the prefix didn't match — prepend Librarian framing.
    return `The Librarian has filed the following alterations:\n\n${diffContent}`;
  }
  return rephrased;
}

async function postLibrarianMessage(chatId: string, content: string, kindLabel: string): Promise<MessageEvent | null> {
  try {
    const repos = getRepositories();

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      logger.debug('[LibrarianNotification] Chat not found, skipping announcement', {
        context: 'librarian-notifications',
        chatId,
        kindLabel,
      });
      return null;
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();

    const message: MessageEvent = {
      type: 'message',
      id: messageId,
      role: 'ASSISTANT',
      content,
      attachments: [],
      createdAt: now,
      participantId: null,
      systemSender: 'librarian',
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[LibrarianNotification] Announcement posted', {
      context: 'librarian-notifications',
      chatId,
      messageId,
      kindLabel,
    });

    return message;
  } catch (error) {
    logger.error('[LibrarianNotification] Failed to post announcement', {
      context: 'librarian-notifications',
      chatId,
      kindLabel,
      error: getErrorMessage(error),
    }, error as Error);
    return null;
  }
}

export async function postLibrarianOpenAnnouncement(
  params: LibrarianOpenAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildOpenContent(params);
  const kindLabel = params.origin.kind;
  logger.debug('[LibrarianNotification] Posting open announcement', {
    context: 'librarian-notifications',
    chatId: params.chatId,
    filePath: params.filePath,
    scope: params.scope,
    isNew: params.isNew,
    kindLabel,
  });
  return postLibrarianMessage(params.chatId, content, kindLabel);
}

export async function postLibrarianSaveAnnouncement(
  params: LibrarianSaveAnnouncement,
): Promise<MessageEvent | null> {
  if (!params.diffContent || !params.diffContent.trim()) {
    logger.debug('[LibrarianNotification] Empty save diff, skipping announcement', {
      context: 'librarian-notifications',
      chatId: params.chatId,
    });
    return null;
  }
  const content = buildSaveContent(params.diffContent);
  logger.debug('[LibrarianNotification] Posting save announcement', {
    context: 'librarian-notifications',
    chatId: params.chatId,
  });
  return postLibrarianMessage(params.chatId, content, 'saved');
}
