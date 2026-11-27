/**
 * Conversation Summary Title Sync (startup self-heal)
 *
 * A conversation's summary file in each participant's vault
 * (`Conversation Summaries/<title>.md`) is named, and its frontmatter
 * `conversationTitle` stamped, from the chat's title *at the fold that wrote
 * it*. Chats get retitled all the time (the automatic title check, the
 * context-summary fold, a hand rename), so between folds the file drifts: the
 * name in the vault and the title recall reports for "relevant past
 * conversations" both name a scene the chat has since left behind.
 *
 * The file's identity is its frontmatter `conversationId`, never its name, so
 * this pass can always find the chat again. On every boot it walks each live
 * character vault's summary folder and, for each file whose chat still exists:
 *
 *   - renames the file to the chat's current title (the same name rule the
 *     writer uses — {@link summaryFileName}, falling back to
 *     {@link disambiguatedSummaryFileName} when another conversation holds the
 *     name). A rename moves the link row only, so chunks and embeddings stay.
 *   - rewrites the frontmatter `conversationTitle` when it differs. The write
 *     re-chunks the file and queues its embedding again; frontmatter is stripped
 *     before chunking, so the vectors come back the same, but the document layer
 *     has no "frontmatter-only" write and this is the price of keeping one door.
 *
 * Nothing else in the file changes (`updatedAt` stays the fold's). Files whose
 * chat is gone are left alone — the chat-delete sweep owns those. Archived
 * characters are skipped, as the writer skips them (their summaries are packed
 * in the archive bundle). A no-op on an instance whose files already match.
 *
 * Runs in the parent (the sole DB writer), chained after the vault backfill in
 * `instrumentation.ts` so every vault exists before it is walked.
 *
 * @module startup/sync-conversation-summary-titles
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  SUMMARIES_FOLDER,
  summaryFileName,
  disambiguatedSummaryFileName,
} from '@/lib/file-storage/conversation-summary-vault-bridge';
import {
  listDatabaseFiles,
  readDatabaseDocument,
  writeDatabaseDocument,
  moveDatabaseDocument,
  databaseDocumentExists,
} from '@/lib/mount-index/database-store';
import { parseFrontmatter, updateFrontmatterInContent } from '@/lib/doc-edit/markdown-parser';

const logger = createServiceLogger('Startup:ConversationSummaryTitleSync');

export interface ConversationSummaryTitleSyncResult {
  vaults: number;
  files: number;
  renamed: number;
  retitled: number;
  /** Files whose chat no longer exists (left alone). */
  orphaned: number;
  errors: number;
}

/** Case-insensitive path equality, the database store's NOCASE rule. */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Pick the path a summary file should live at, given the chat's current title.
 * Returns the current path when it is already right, or null when both the
 * plain and the disambiguated names belong to other files.
 */
async function chooseTargetPath(
  mountPointId: string,
  currentPath: string,
  chatId: string,
  title: string,
): Promise<string | null> {
  const desired = `${SUMMARIES_FOLDER}/${summaryFileName(chatId, title)}`;
  if (currentPath === desired) return currentPath;
  // A case-only difference is a legal rename of the same row.
  if (samePath(currentPath, desired) || !(await databaseDocumentExists(mountPointId, desired))) {
    return desired;
  }

  const fallback = `${SUMMARIES_FOLDER}/${disambiguatedSummaryFileName(chatId, title)}`;
  if (currentPath === fallback) return currentPath;
  if (samePath(currentPath, fallback) || !(await databaseDocumentExists(mountPointId, fallback))) {
    return fallback;
  }
  return null;
}

export async function syncConversationSummaryTitles(): Promise<ConversationSummaryTitleSyncResult> {
  const result: ConversationSummaryTitleSyncResult = {
    vaults: 0,
    files: 0,
    renamed: 0,
    retitled: 0,
    orphaned: 0,
    errors: 0,
  };

  const repos = getRepositories();
  const characters = await repos.characters.findAllRaw();

  // A conversation's file sits in every participant's vault; read each chat once.
  const titleCache = new Map<string, string | null>();
  const currentTitle = async (chatId: string): Promise<string | null> => {
    if (titleCache.has(chatId)) return titleCache.get(chatId) ?? null;
    let title: string | null = null;
    try {
      const chat = await repos.chats.findById(chatId);
      title = chat && typeof chat.title === 'string' && chat.title.trim() ? chat.title : null;
    } catch (error) {
      logger.debug('Could not read chat for summary title sync', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    titleCache.set(chatId, title);
    return title;
  };

  for (const character of characters) {
    if (character.archivedAt || !character.characterDocumentMountPointId) continue;

    let mountPointId: string;
    try {
      const mp = await repos.docMountPoints.findById(character.characterDocumentMountPointId);
      if (!mp || mp.mountType !== 'database' || mp.storeType !== 'character') continue;
      mountPointId = mp.id;
    } catch (error) {
      result.errors++;
      logger.warn('Could not resolve character vault for summary title sync', {
        characterId: character.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    let entries;
    try {
      entries = await listDatabaseFiles(mountPointId, { folder: SUMMARIES_FOLDER });
    } catch (error) {
      result.errors++;
      logger.warn('Could not list conversation summaries in vault', {
        characterId: character.id,
        mountPointId,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const files = entries.filter(
      (e) => e.kind !== 'folder' && e.relativePath.toLowerCase().endsWith('.md'),
    );
    if (files.length === 0) continue;
    result.vaults++;

    for (const entry of files) {
      result.files++;
      try {
        const { content } = await readDatabaseDocument(mountPointId, entry.relativePath);
        const { data } = parseFrontmatter(content);
        const chatId = data && typeof data.conversationId === 'string' ? data.conversationId : null;
        if (!chatId) continue;

        const title = await currentTitle(chatId);
        if (!title) {
          result.orphaned++;
          continue;
        }

        let path = entry.relativePath;
        const target = await chooseTargetPath(mountPointId, path, chatId, title);
        if (target === null) {
          logger.warn('Both summary file names are taken by other files; leaving name as is', {
            characterId: character.id,
            chatId,
            path,
          });
        } else if (target !== path) {
          await moveDatabaseDocument(mountPointId, path, target);
          logger.debug('Renamed conversation summary to current chat title', {
            characterId: character.id,
            chatId,
            from: path,
            to: target,
          });
          path = target;
          result.renamed++;
        }

        if (data?.conversationTitle !== title) {
          await writeDatabaseDocument(
            mountPointId,
            path,
            updateFrontmatterInContent(content, { conversationTitle: title }),
          );
          result.retitled++;
        }
      } catch (error) {
        result.errors++;
        logger.warn('Failed to sync a conversation summary title', {
          characterId: character.id,
          mountPointId,
          path: entry.relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  logger.info('Conversation summary title sync complete', { ...result });
  return result;
}
