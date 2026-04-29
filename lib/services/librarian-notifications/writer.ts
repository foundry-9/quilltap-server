/**
 * Writer for Document Mode chat notifications (the Librarian).
 *
 * When a document is opened in Document Mode or saved from the editor, this
 * helper injects a synthetic ASSISTANT-role chat message announcing the event
 * on behalf of the Librarian. Characters see the announcement in their recent
 * history and know the document is available (and who opened it), without the
 * user losing their turn to the LLM.
 *
 * Kinds of announcements:
 *   - 'opened-by-user'       → user-initiated Document Mode open
 *   - 'opened-by-character'  → character-initiated via the `doc_open_document` tool
 *   - 'saved'                → user autosave/manual-save from the editor (includes unified diff)
 *   - 'renamed'              → user-initiated rename via the Document Mode title input
 *   - 'deleted'              → file removed (user Delete button, or character `doc_delete_file` tool)
 *   - 'folder-created'       → character `doc_create_folder` tool
 *   - 'folder-deleted'       → character `doc_delete_folder` tool
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

/**
 * Who initiated a destructive or structural change.
 * Shared by delete / folder-create / folder-delete announcements.
 */
export type LibrarianActorOrigin =
  | { kind: 'by-user' }
  | { kind: 'by-character'; characterName: string };

export interface LibrarianOpenAnnouncement {
  chatId: string;
  displayTitle: string;
  filePath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  isNew: boolean;
  origin: LibrarianOpenKind;
}

export interface LibrarianDeleteAnnouncement {
  chatId: string;
  displayTitle: string;
  filePath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  origin: LibrarianActorOrigin;
}

export interface LibrarianFolderCreatedAnnouncement {
  chatId: string;
  folderPath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  origin: LibrarianActorOrigin;
}

export interface LibrarianFolderDeletedAnnouncement {
  chatId: string;
  folderPath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
  origin: LibrarianActorOrigin;
}

export interface LibrarianSaveAnnouncement {
  chatId: string;
  /** Pre-formatted diff content (from formatAutosaveNotification) — caller owns the diff */
  diffContent: string;
}

export interface LibrarianRenameAnnouncement {
  chatId: string;
  oldDisplayTitle: string;
  newDisplayTitle: string;
  oldFilePath: string;
  newFilePath: string;
  scope: 'project' | 'document_store' | 'general';
  mountPoint?: string | null;
}

/**
 * Announcement that the user has pinned a Scriptorium document-store file
 * to the chat for the LLM to consult. The doc_mount_files row id rides on
 * the synthetic message's `attachments` so the existing assistant-attachment
 * walker surfaces the bytes to the next character turn — text excerpts go
 * through fallback, images go to vision providers natively.
 *
 * For images, an optional `description` is woven into the announcement body
 * so non-vision providers (which would otherwise see only the announcement
 * sentence and silently drop the bytes) still know what was placed before
 * them. The description is generated from the image once at attach time and
 * cached on `doc_mount_blobs.description`.
 */
export interface LibrarianAttachAnnouncement {
  chatId: string;
  displayTitle: string;
  filePath: string;
  mountPoint?: string | null;
  /** doc_mount_files.id of the attached file */
  mountFileId: string;
  /** MIME type (storedMimeType from the blob row) */
  mimeType: string;
  /** Cached or freshly-generated image description; empty for non-images or unavailable */
  description?: string;
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

function actorLabel(origin: LibrarianActorOrigin): string {
  return origin.kind === 'by-user'
    ? "the user's instruction"
    : `${origin.characterName}'s instruction`;
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

export function buildRenameContent(params: LibrarianRenameAnnouncement): string {
  const { oldDisplayTitle, newDisplayTitle, oldFilePath, newFilePath, scope, mountPoint } = params;
  const where = scopeLabel(scope, mountPoint);
  const pathDetails = `old_path: "${oldFilePath}", new_path: "${newFilePath}", scope: "${scope}"${mountPoint ? `, mount_point: "${mountPoint}"` : ''}`;
  return `The Librarian has rechristened the volume formerly catalogued as "${oldDisplayTitle}" in ${where} — it now answers to "${newDisplayTitle}", and the card in the catalogue has been amended to suit. Subsequent references should use the new name (${pathDetails}).`;
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

async function postLibrarianMessage(
  chatId: string,
  content: string,
  kindLabel: string,
  attachments: string[] = [],
  targetParticipantIds: string[] | null = null,
): Promise<MessageEvent | null> {
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
      attachments,
      createdAt: now,
      participantId: null,
      systemSender: 'librarian',
      systemKind: kindLabel,
      targetParticipantIds: targetParticipantIds && targetParticipantIds.length > 0 ? targetParticipantIds : null,
    };

    await repos.chats.addMessage(chatId, message);

    logger.info('[LibrarianNotification] Announcement posted', {
      context: 'librarian-notifications',
      chatId,
      messageId,
      kindLabel,
      attachmentCount: attachments.length,
      targetParticipantIds,
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

export async function postLibrarianRenameAnnouncement(
  params: LibrarianRenameAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildRenameContent(params);
  logger.debug('[LibrarianNotification] Posting rename announcement', {
    context: 'librarian-notifications',
    chatId: params.chatId,
    oldFilePath: params.oldFilePath,
    newFilePath: params.newFilePath,
    scope: params.scope,
  });
  return postLibrarianMessage(params.chatId, content, 'renamed');
}

export function buildDeleteContent(params: LibrarianDeleteAnnouncement): string {
  const { displayTitle, filePath, scope, mountPoint, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = actorLabel(origin);
  const pathDetails = `path: "${filePath}", scope: "${scope}"${mountPoint ? `, mount_point: "${mountPoint}"` : ''}`;
  return `The Librarian has removed "${displayTitle}" from ${where} at ${who}. The volume is gone from the shelves, and its card struck from the catalogue (${pathDetails}).`;
}

export function buildFolderCreatedContent(params: LibrarianFolderCreatedAnnouncement): string {
  const { folderPath, scope, mountPoint, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = actorLabel(origin);
  const pathDetails = `path: "${folderPath}", scope: "${scope}"${mountPoint ? `, mount_point: "${mountPoint}"` : ''}`;
  return `The Librarian has set aside a fresh shelf for "${folderPath}" in ${where} at ${who} — a new folder, presently empty, awaiting its tenants (${pathDetails}).`;
}

export function buildFolderDeletedContent(params: LibrarianFolderDeletedAnnouncement): string {
  const { folderPath, scope, mountPoint, origin } = params;
  const where = scopeLabel(scope, mountPoint);
  const who = actorLabel(origin);
  const pathDetails = `path: "${folderPath}", scope: "${scope}"${mountPoint ? `, mount_point: "${mountPoint}"` : ''}`;
  return `The Librarian has dismantled the empty shelf at "${folderPath}" in ${where} at ${who}. The folder has been cleared from the catalogue (${pathDetails}).`;
}

export async function postLibrarianDeleteAnnouncement(
  params: LibrarianDeleteAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildDeleteContent(params);
  const kindLabel = params.origin.kind === 'by-user' ? 'deleted-by-user' : 'deleted-by-character';
  logger.debug('[LibrarianNotification] Posting delete announcement', {
    context: 'librarian-notifications',
    chatId: params.chatId,
    filePath: params.filePath,
    scope: params.scope,
    kindLabel,
  });
  return postLibrarianMessage(params.chatId, content, kindLabel);
}

export async function postLibrarianFolderCreatedAnnouncement(
  params: LibrarianFolderCreatedAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildFolderCreatedContent(params);
  const kindLabel = params.origin.kind === 'by-user' ? 'folder-created-by-user' : 'folder-created-by-character';
  logger.debug('[LibrarianNotification] Posting folder-created announcement', {
    context: 'librarian-notifications',
    chatId: params.chatId,
    folderPath: params.folderPath,
    scope: params.scope,
    kindLabel,
  });
  return postLibrarianMessage(params.chatId, content, kindLabel);
}

function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/');
}

export function buildAttachContent(params: LibrarianAttachAnnouncement): string {
  const { displayTitle, filePath, mountPoint, mimeType, description } = params;
  const where = mountPoint ? `the document store "${mountPoint}"` : 'the document store';
  const pathDetails = `path: "${filePath}"${mountPoint ? `, mount_point: "${mountPoint}"` : ''}`;
  const kindPhrase = isImageMime(mimeType)
    ? `the illustration "${displayTitle}"`
    : `the volume "${displayTitle}"`;
  const lead = `The user has bid the Librarian set ${kindPhrase} from ${where} upon the table for your perusal — please consult it as part of your reply (${pathDetails}).`;
  // Splice the description into the announcement body for the benefit of
  // non-vision providers that would otherwise see only the lead sentence.
  // Vision providers see both the description text *and* the image bytes.
  const trimmed = description?.trim();
  if (trimmed) {
    return `${lead}\n\nThe Librarian's catalogue describes the illustration thus:\n\n${trimmed}`;
  }
  return lead;
}

export async function postLibrarianAttachAnnouncement(
  params: LibrarianAttachAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildAttachContent(params);
  logger.debug('[LibrarianNotification] Posting attach announcement', {
    context: 'librarian-notifications',
    chatId: params.chatId,
    filePath: params.filePath,
    mountFileId: params.mountFileId,
    mimeType: params.mimeType,
  });
  return postLibrarianMessage(params.chatId, content, 'attached', [params.mountFileId]);
}

export async function postLibrarianFolderDeletedAnnouncement(
  params: LibrarianFolderDeletedAnnouncement,
): Promise<MessageEvent | null> {
  const content = buildFolderDeletedContent(params);
  const kindLabel = params.origin.kind === 'by-user' ? 'folder-deleted-by-user' : 'folder-deleted-by-character';
  logger.debug('[LibrarianNotification] Posting folder-deleted announcement', {
    context: 'librarian-notifications',
    chatId: params.chatId,
    folderPath: params.folderPath,
    scope: params.scope,
    kindLabel,
  });
  return postLibrarianMessage(params.chatId, content, kindLabel);
}

// ---------------------------------------------------------------------------
// Phase F: conversation-summary whispers. Replaces the per-turn `## Previous
// Conversation Summary` system-prompt block. Posted whenever the chat's
// `contextSummary` is regenerated by the cheap-LLM summariser. As of the
// per-character summary refactor these are always whispered to a single
// participant — the whole chat doesn't share one summary, since each
// character may have entered mid-stream or stepped away and back.
// ---------------------------------------------------------------------------

export const SUMMARY_CONTENT_PREFIX =
  'The Librarian deposits a précis of the conversation to date upon the table — file it for reference:';

export interface LibrarianSummaryAnnouncement {
  chatId: string;
  summary: string;
  /**
   * Participant IDs that should receive this summary as a whisper. When
   * provided, the summary becomes a private message visible only to the
   * sender and the listed participants.
   */
  targetParticipantIds?: string[] | null;
}

export function buildSummaryContent(summary: string): string {
  return [
    SUMMARY_CONTENT_PREFIX,
    '',
    summary.trim(),
  ].join('\n');
}

export async function postLibrarianSummaryAnnouncement(
  params: LibrarianSummaryAnnouncement,
): Promise<MessageEvent | null> {
  if (!params.summary || params.summary.trim().length === 0) {
    logger.debug('[LibrarianNotification] Empty summary, skipping announcement', {
      context: 'librarian-notifications',
      chatId: params.chatId,
    });
    return null;
  }
  const content = buildSummaryContent(params.summary);
  logger.debug('[LibrarianNotification] Posting summary announcement', {
    context: 'librarian-notifications',
    chatId: params.chatId,
    summaryLength: params.summary.length,
    targetParticipantIds: params.targetParticipantIds ?? null,
  });
  return postLibrarianMessage(
    params.chatId,
    content,
    'summary',
    [],
    params.targetParticipantIds ?? null,
  );
}
