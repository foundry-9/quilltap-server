/**
 * Document Editing Tool Handler
 *
 * Consolidated handler for all doc_* editing tools.
 * Dispatches by tool name to the appropriate operation.
 *
 * Scriptorium Phase 3.3
 *
 * @module tools/handlers/doc-edit-handler
 */

import path from 'path';
import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';
import {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
  getAccessibleMountPoints,
  isTextFile,
  PathResolutionError,
  findUniqueMatch,
  findAllMatches,
  reindexSingleFile,
  parseFrontmatter,
  updateFrontmatterInContent,
  findHeadingSection,
  readHeadingContent,
  replaceHeadingContent,
  type DocEditScope,
  type ResolvedPath,
} from '@/lib/doc-edit';
import {
  detectMimeFromExtension,
  isJsonFamily,
  isJsonMime,
  isJsonlMime,
  parseContent,
  serializeContent,
  validateJson,
  type JsonlLineResult,
} from '@/lib/doc-edit/mime-registry';

import type { DocReadFileInput, DocReadFileOutput } from '../doc-read-file-tool';
import type { DocWriteFileInput, DocWriteFileOutput } from '../doc-write-file-tool';
import type { DocStrReplaceInput, DocStrReplaceOutput } from '../doc-str-replace-tool';
import type { DocInsertTextInput, DocInsertTextOutput } from '../doc-insert-text-tool';
import type { DocGrepInput, DocGrepOutput, DocGrepMatch } from '../doc-grep-tool';
import type { DocListFilesInput, DocListFilesOutput, DocFileInfo } from '../doc-list-files-tool';
import type { DocReadFrontmatterInput, DocReadFrontmatterOutput } from '../doc-read-frontmatter-tool';
import type { DocUpdateFrontmatterInput, DocUpdateFrontmatterOutput } from '../doc-update-frontmatter-tool';
import type { DocReadHeadingInput, DocReadHeadingOutput } from '../doc-read-heading-tool';
import type { DocUpdateHeadingInput, DocUpdateHeadingOutput } from '../doc-update-heading-tool';
import type { DocMoveFileInput, DocMoveFileOutput } from '../doc-move-file-tool';
import type { DocCopyFileInput, DocCopyFileOutput } from '../doc-copy-file-tool';
import type { DocDeleteFileInput, DocDeleteFileOutput } from '../doc-delete-file-tool';
import type { DocCreateFolderInput, DocCreateFolderOutput } from '../doc-create-folder-tool';
import type { DocDeleteFolderInput, DocDeleteFolderOutput } from '../doc-delete-folder-tool';
import type { DocMoveFolderInput, DocMoveFolderOutput } from '../doc-move-folder-tool';
import type { DocOpenDocumentInput, DocOpenDocumentOutput } from '../doc-open-document-tool';
import type { DocCloseDocumentInput, DocCloseDocumentOutput } from '../doc-close-document-tool';
import type { DocFocusInput, DocFocusOutput } from '../doc-focus-tool';
import type { DocWriteBlobInput, DocWriteBlobOutput } from '../doc-write-blob-tool';
import type { DocReadBlobInput, DocReadBlobOutput } from '../doc-read-blob-tool';
import type { DocListBlobsInput, DocListBlobsOutput } from '../doc-list-blobs-tool';
import type { DocDeleteBlobInput, DocDeleteBlobOutput } from '../doc-delete-blob-tool';
import { transcodeToWebP, normaliseBlobRelativePath } from '@/lib/mount-index/blob-transcode';
import { getRepositories } from '@/lib/database/repositories';
import { isParticipantPresent } from '@/lib/schemas/chat.types';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';
import {
  postLibrarianOpenAnnouncement,
  postLibrarianDeleteAnnouncement,
  postLibrarianFolderCreatedAnnouncement,
  postLibrarianFolderDeletedAnnouncement,
  type LibrarianActorOrigin,
} from '@/lib/services/librarian-notifications/writer';
import {
  databaseDocumentExists,
  databaseFolderExists,
  databaseFolderHasContents,
  deleteDatabaseDocument,
  moveDatabaseDocument,
  createDatabaseFolder,
  deleteDatabaseFolder,
  moveDatabaseFolder,
  listDatabaseFiles,
} from '@/lib/mount-index/database-store';

const logger = createServiceLogger('DocEdit:Handler');

// ============================================================================
// Tool name constants and dispatch
// ============================================================================

export const DOC_EDIT_TOOL_NAMES = new Set([
  'doc_read_file',
  'doc_write_file',
  'doc_str_replace',
  'doc_insert_text',
  'doc_grep',
  'doc_list_files',
  'doc_read_frontmatter',
  'doc_update_frontmatter',
  'doc_read_heading',
  'doc_update_heading',
  'doc_move_file',
  'doc_copy_file',
  'doc_delete_file',
  'doc_create_folder',
  'doc_delete_folder',
  'doc_move_folder',
  'doc_open_document',
  'doc_close_document',
  'doc_focus',
  'doc_write_blob',
  'doc_read_blob',
  'doc_list_blobs',
  'doc_delete_blob',
]);

/**
 * Check if a tool name is a doc-edit tool.
 */
export function isDocEditTool(name: string): boolean {
  return DOC_EDIT_TOOL_NAMES.has(name);
}

/**
 * Context required for doc-edit tool execution.
 */
export interface DocEditToolContext {
  chatId: string;
  userId: string;
  projectId?: string;
  characterId?: string;
}

/**
 * Execute a doc-edit tool call.
 */
export async function executeDocEditTool(
  toolName: string,
  input: Record<string, unknown>,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: unknown; error?: string; formattedText?: string }> {
  logger.debug('Executing doc-edit tool', { toolName, projectId: context.projectId });

  try {
    switch (toolName) {
      case 'doc_read_file':
        return await handleReadFile(input as unknown as DocReadFileInput, context);
      case 'doc_write_file':
        return await handleWriteFile(input as unknown as DocWriteFileInput, context);
      case 'doc_str_replace':
        return await handleStrReplace(input as unknown as DocStrReplaceInput, context);
      case 'doc_insert_text':
        return await handleInsertText(input as unknown as DocInsertTextInput, context);
      case 'doc_grep':
        return await handleGrep(input as unknown as DocGrepInput, context);
      case 'doc_list_files':
        return await handleListFiles(input as unknown as DocListFilesInput, context);
      case 'doc_read_frontmatter':
        return await handleReadFrontmatter(input as unknown as DocReadFrontmatterInput, context);
      case 'doc_update_frontmatter':
        return await handleUpdateFrontmatter(input as unknown as DocUpdateFrontmatterInput, context);
      case 'doc_read_heading':
        return await handleReadHeading(input as unknown as DocReadHeadingInput, context);
      case 'doc_update_heading':
        return await handleUpdateHeading(input as unknown as DocUpdateHeadingInput, context);
      case 'doc_move_file':
        return await handleMoveFile(input as unknown as DocMoveFileInput, context);
      case 'doc_copy_file':
        return await handleCopyFile(input as unknown as DocCopyFileInput, context);
      case 'doc_delete_file':
        return await handleDeleteFile(input as unknown as DocDeleteFileInput, context);
      case 'doc_create_folder':
        return await handleCreateFolder(input as unknown as DocCreateFolderInput, context);
      case 'doc_delete_folder':
        return await handleDeleteFolder(input as unknown as DocDeleteFolderInput, context);
      case 'doc_move_folder':
        return await handleMoveFolder(input as unknown as DocMoveFolderInput, context);
      case 'doc_open_document':
        return await handleOpenDocument(input as unknown as DocOpenDocumentInput, context);
      case 'doc_close_document':
        return await handleCloseDocument(input as unknown as DocCloseDocumentInput, context);
      case 'doc_focus':
        return await handleDocFocus(input as unknown as DocFocusInput, context);
      case 'doc_write_blob':
        return await handleWriteBlob(input as unknown as DocWriteBlobInput, context);
      case 'doc_read_blob':
        return await handleReadBlob(input as unknown as DocReadBlobInput, context);
      case 'doc_list_blobs':
        return await handleListBlobs(input as unknown as DocListBlobsInput, context);
      case 'doc_delete_blob':
        return await handleDeleteBlob(input as unknown as DocDeleteBlobInput, context);
      default:
        return { success: false, error: `Unknown doc-edit tool: ${toolName}` };
    }
  } catch (error) {
    if (error instanceof PathResolutionError) {
      logger.warn('Path resolution error in doc-edit tool', {
        toolName,
        code: error.code,
        message: error.message,
      });
      return {
        success: false,
        error: error.message,
        formattedText: `Error: ${error.message}`,
      };
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Unexpected error in doc-edit tool', { toolName, error: errorMsg });
    return {
      success: false,
      error: errorMsg,
      formattedText: `Error: ${errorMsg}`,
    };
  }
}

/**
 * Format doc-edit tool results for LLM consumption.
 */
export function formatDocEditResults(
  toolName: string,
  result: { success: boolean; result?: unknown; error?: string; formattedText?: string }
): string {
  if (result.formattedText) {
    return result.formattedText;
  }
  if (!result.success) {
    return `Error: ${result.error || 'Unknown error'}`;
  }
  return JSON.stringify(result.result, null, 2);
}

// ============================================================================
// Tier 1: Text-Primitive Handlers
// ============================================================================

/**
 * Collect the character IDs of other present participants in the chat whose
 * vaults should be readable — only when the chat has the
 * `allowCrossCharacterVaultReads` flag enabled. Returns an empty array when
 * the flag is off, the chat isn't found, or the acting character is the only
 * present participant.
 */
async function collectPeerCharacterIdsForReads(
  context: DocEditToolContext
): Promise<string[]> {
  if (!context.chatId) return [];
  const repos = getRepositories();
  const chat = await repos.chats.findById(context.chatId);
  if (!chat || !chat.allowCrossCharacterVaultReads) return [];

  const acting = context.characterId;
  const peers = new Set<string>();
  for (const p of chat.participants) {
    if (!p.characterId) continue;
    if (p.characterId === acting) continue;
    if (!isParticipantPresent(p.status)) continue;
    peers.add(p.characterId);
  }
  return Array.from(peers);
}

/**
 * When a character has `systemTransparency !== true` they accept the covenant
 * of trust — every character vault (their own and peers') is hidden from
 * doc_* tools. Returns true if the acting character is opaque; falls back to
 * "opaque" on lookup failure so a transient repo error doesn't accidentally
 * grant access. Project-linked document stores remain accessible regardless.
 */
async function actingCharacterIsOpaqueToVaults(
  context: DocEditToolContext
): Promise<boolean> {
  if (!context.characterId) return false;
  try {
    const repos = getRepositories();
    const character = await repos.characters.findById(context.characterId);
    return character?.systemTransparency !== true;
  } catch (err) {
    logger.warn('systemTransparency lookup failed; defaulting to opaque', {
      characterId: context.characterId,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

/**
 * If the requested mount_point refers to a peer participant's vault while
 * cross-character reads are enabled, throw a clear read-only error. This
 * turns what would otherwise be a generic "mount point not accessible"
 * message into a specific message explaining the cross-character boundary.
 */
async function assertWriteDoesNotTargetPeerVault(
  mountPointHint: string | undefined,
  peerCharacterIds: string[]
): Promise<void> {
  if (!mountPointHint || peerCharacterIds.length === 0) return;
  const repos = getRepositories();
  const needle = mountPointHint.toLowerCase();
  for (const peerId of peerCharacterIds) {
    const peer = await repos.characters.findById(peerId);
    if (!peer?.characterDocumentMountPointId) continue;
    if (peer.characterDocumentMountPointId === mountPointHint) {
      logger.info('Rejected write to peer character vault (read-only in this chat)', {
        peerCharacterId: peerId,
        mountPointId: peer.characterDocumentMountPointId,
      });
      throw new PathResolutionError(
        `${peer.name}'s vault is read-only in this chat. Cross-character vault sharing permits reads only.`,
        'ACCESS_DENIED'
      );
    }
    const mp = await repos.docMountPoints.findById(peer.characterDocumentMountPointId);
    if (mp && mp.name.toLowerCase() === needle) {
      logger.info('Rejected write to peer character vault (read-only in this chat)', {
        peerCharacterId: peerId,
        mountPointName: mp.name,
      });
      throw new PathResolutionError(
        `${peer.name}'s vault is read-only in this chat. Cross-character vault sharing permits reads only.`,
        'ACCESS_DENIED'
      );
    }
  }
}

/**
 * Build resolution context for a read operation. When the chat has
 * `allowCrossCharacterVaultReads` enabled, the vaults of other present
 * participants are added to `characterIds` so the path resolver admits them.
 */
async function buildReadResolutionContext(
  input: { scope?: string; mount_point?: string },
  context: DocEditToolContext
) {
  const opaque = await actingCharacterIsOpaqueToVaults(context);
  if (opaque) {
    logger.debug('Acting character is opaque (systemTransparency != true); withholding character-vault access', {
      chatId: context.chatId,
      actingCharacterId: context.characterId,
      mountPointHint: input.mount_point,
    });
    // No characterId / characterIds → resolver admits only project document
    // stores. Mount-point name lookups for character vaults won't resolve.
    return {
      projectId: context.projectId,
      mountPoint: input.mount_point,
    };
  }
  const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
  if (peerCharacterIds.length > 0) {
    logger.debug('Cross-character vault reads enabled; expanding access', {
      chatId: context.chatId,
      actingCharacterId: context.characterId,
      peerCharacterIds,
    });
  }
  return {
    projectId: context.projectId,
    characterId: context.characterId,
    characterIds: peerCharacterIds.length > 0 ? peerCharacterIds : undefined,
    mountPoint: input.mount_point,
  };
}

/**
 * Build resolution context for a write operation. Peer vaults are never
 * admitted here; attempts to write to a peer's vault by name or ID raise
 * a clear read-only error before resolution runs.
 */
async function buildWriteResolutionContext(
  input: { scope?: string; mount_point?: string },
  context: DocEditToolContext
) {
  const opaque = await actingCharacterIsOpaqueToVaults(context);
  if (opaque) {
    logger.debug('Acting character is opaque (systemTransparency != true); withholding character-vault write access', {
      chatId: context.chatId,
      actingCharacterId: context.characterId,
      mountPointHint: input.mount_point,
    });
    return {
      projectId: context.projectId,
      mountPoint: input.mount_point,
    };
  }
  const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
  await assertWriteDoesNotTargetPeerVault(input.mount_point, peerCharacterIds);
  return {
    projectId: context.projectId,
    characterId: context.characterId,
    mountPoint: input.mount_point,
  };
}

/**
 * Trigger re-indexing and embedding for document store files after a write.
 */
async function triggerReindexIfNeeded(resolved: ResolvedPath): Promise<void> {
  if (resolved.scope === 'document_store' && resolved.mountPointId) {
    const mountPointId = resolved.mountPointId;
    const repos = getRepositories();
    // Fire-and-forget: don't block the tool response on re-indexing
    reindexSingleFile(mountPointId, resolved.relativePath, resolved.absolutePath)
      .then(() => Promise.all([
        enqueueEmbeddingJobsForMountPoint(mountPointId),
        repos.docMountPoints.refreshStats(mountPointId),
      ]))
      .catch(err => {
        logger.warn('Background re-index, embedding, or stats refresh failed', {
          path: resolved.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }
}

/**
 * Get the line number for a character offset in content.
 */
function getLineNumber(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

// --- doc_read_file ---

async function handleReadFile(
  input: DocReadFileInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocReadFileOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildReadResolutionContext(input, context));

  // For database-backed stores, a non-text file (pdf/docx/arbitrary binary)
  // may still be readable if the blob has an extractedText representation.
  // Return that derived text with derivedFromBlob=true so callers know the
  // original bytes aren't what they're seeing.
  if (!isTextFile(resolved.relativePath)) {
    if (resolved.mountType === 'database' && resolved.mountPointId) {
      const repos = getRepositories();
      const blob = await repos.docMountBlobs.findByMountPointAndPath(
        resolved.mountPointId,
        resolved.relativePath
      );
      if (blob?.extractedText && blob.extractionStatus === 'converted') {
        const text = blob.extractedText;
        const lines = text.split('\n');
        const totalLines = lines.length;

        let outputLines = lines;
        let truncated = false;
        if (input.offset || input.limit) {
          const startLine = (input.offset || 1) - 1;
          const endLine = input.limit ? startLine + input.limit : lines.length;
          outputLines = lines.slice(startLine, endLine);
          truncated = endLine < lines.length;
        }

        const lineStart = input.offset || 1;
        const numberedLines = outputLines
          .map((line, i) => `[L${lineStart + i}] ${line}`)
          .join('\n');
        const header = `File: ${input.path} (extracted text from ${blob.storedMimeType}, ${totalLines} lines, ${blob.sizeBytes} original bytes)`;
        const truncMsg = truncated
          ? `\n[Truncated — showing lines ${lineStart}-${lineStart + outputLines.length - 1} of ${totalLines}]`
          : '';
        const formattedText = `${header}${truncMsg}\n\n${numberedLines}`;

        const result: DocReadFileOutput = {
          content: outputLines.join('\n'),
          mimeType: blob.storedMimeType,
          path: input.path,
          mtime: new Date(blob.updatedAt).getTime(),
          totalLines,
          truncated,
          derivedFromBlob: true,
        };
        return { success: true, result, formattedText };
      }
    }
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content: rawContent, mtime, size } = await readFileWithMtime(resolved);
  const mime = detectMimeFromExtension(resolved.relativePath);

  let content: string | unknown = rawContent;
  let parsed = false;
  let parseError: { message: string; line?: number } | undefined;
  let formattedText: string;

  // For JSON/JSONL, parse the content
  if (isJsonFamily(mime)) {
    const parseResult = parseContent(rawContent, mime!);
    if (parseResult.ok) {
      content = parseResult.value;
      parsed = true;

      if (isJsonlMime(mime)) {
        const lines = parseResult.value as JsonlLineResult[];
        parsed = lines.some(l => !l.error);

        // Format JSONL for display
        const lines_formatted = lines.map(
          (l) => `[L${l.line}] ${l.error ? `PARSE ERROR: ${l.error}` : JSON.stringify(l.value)}`
        );
        formattedText = `File: ${input.path} (JSONL, ${lines.length} entries)\n\n${lines_formatted.join('\n')}`;
      } else {
        // Format JSON for display
        const formatted = JSON.stringify(content, null, 2);
        formattedText = `File: ${input.path} (JSON)\n\n${formatted}`;
      }
    } else {
      content = rawContent;
      parsed = false;
      parseError = { message: parseResult.error, line: parseResult.line };
      formattedText = `File: ${input.path} — Parse Error: ${parseResult.error}`;
    }
  } else {
    // Non-JSON: format with line numbers as before
    const lines = rawContent.split('\n');
    const totalLines = lines.length;

    let outputLines = lines;
    let truncated = false;

    if (input.offset || input.limit) {
      const startLine = (input.offset || 1) - 1;
      const endLine = input.limit ? startLine + input.limit : lines.length;
      outputLines = lines.slice(startLine, endLine);
      truncated = endLine < lines.length;
    }

    content = outputLines.join('\n');
    const lineStart = input.offset || 1;
    const numberedLines = outputLines.map((line, i) => `[L${lineStart + i}] ${line}`).join('\n');
    const header = `File: ${input.path} (${totalLines} lines, ${size} bytes)`;
    const truncMsg = truncated ? `\n[Truncated — showing lines ${lineStart}-${lineStart + outputLines.length - 1} of ${totalLines}]` : '';
    formattedText = `${header}${truncMsg}\n\n${numberedLines}`;
  }

  const lines = rawContent.split('\n');
  const result: DocReadFileOutput = {
    content,
    rawContent: isJsonFamily(mime) ? rawContent : undefined,
    parsed: isJsonFamily(mime) ? parsed : undefined,
    parseError: isJsonFamily(mime) ? parseError : undefined,
    mimeType: mime || undefined,
    path: input.path,
    mtime,
    totalLines: lines.length,
    truncated: false,
  };

  return {
    success: true,
    result,
    formattedText,
  };
}

// --- doc_write_file ---

async function handleWriteFile(
  input: DocWriteFileInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocWriteFileOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const mime = detectMimeFromExtension(resolved.relativePath);
  let contentToWrite: string;

  // Handle JSON/JSONL inputs
  if (isJsonFamily(mime)) {
    if (typeof input.content === 'string') {
      // String input: validate it as JSON
      const validation = validateJson(input.content, mime!);
      if (!validation.ok) {
        const errorMsg = isJsonlMime(mime)
          ? `Invalid JSONL: ${validation.error}`
          : `Invalid JSON: ${validation.error}`;
        logger.info('JSON validation failed on write', { path: input.path, error: validation.error });
        return { success: false, error: errorMsg };
      }
      contentToWrite = input.content;
    } else {
      // Native value input: serialize it
      const serialization = serializeContent(input.content, mime!, { pretty: true });
      if (!serialization.ok) {
        const errorMsg = `Cannot serialize content: ${serialization.error}`;
        logger.info('JSON serialization failed on write', { path: input.path, error: serialization.error });
        return { success: false, error: errorMsg };
      }
      contentToWrite = serialization.value;
    }
  } else {
    // Non-JSON: content must be string
    if (typeof input.content !== 'string') {
      return { success: false, error: `Non-JSON files require string content; got ${typeof input.content}` };
    }
    contentToWrite = input.content;
  }

  const { mtime } = await writeFileWithMtimeCheck(
    resolved,
    contentToWrite,
    input.expected_mtime
  );

  await triggerReindexIfNeeded(resolved);

  const result: DocWriteFileOutput = {
    success: true,
    path: input.path,
    mtime,
  };

  return {
    success: true,
    result,
    formattedText: `File written: ${input.path} (${contentToWrite.length} bytes, mtime: ${mtime})`,
  };
}

// --- doc_str_replace ---

async function handleStrReplace(
  input: DocStrReplaceInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocStrReplaceOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);

  const matchResult = findUniqueMatch(content, input.find, {
    caseSensitive: input.case_sensitive !== false,
    normalizeDiacritics: input.normalize_diacritics !== false,
  });

  if (!matchResult.found) {
    if (matchResult.count === 0) {
      return {
        success: false,
        error: `Text not found in file. The exact text to find was not present in ${input.path}. Make sure you are using the exact text from your most recent read of this file.`,
        formattedText: `Error: Text not found in ${input.path}. No matches for the find text. Re-read the file and use the exact text.`,
      };
    }
    return {
      success: false,
      error: `Multiple matches (${matchResult.count}) found in file. Include more surrounding context in the find text to make it unique.`,
      formattedText: `Error: ${matchResult.count} matches found in ${input.path}. Include more surrounding context to make the match unique.`,
    };
  }

  // Perform the replacement
  const newContent =
    content.substring(0, matchResult.index) +
    input.replace +
    content.substring(matchResult.index + matchResult.length);

  const { mtime } = await writeFileWithMtimeCheck(resolved, newContent);

  await triggerReindexIfNeeded(resolved);

  const lineNumber = getLineNumber(content, matchResult.index);

  const result: DocStrReplaceOutput = {
    success: true,
    path: input.path,
    mtime,
    line_number: lineNumber,
  };

  return {
    success: true,
    result,
    formattedText: `Replaced text at line ${lineNumber} in ${input.path} (mtime: ${mtime}). Note: your previous read of this file is now stale — re-read before making further edits.`,
  };
}

// --- doc_insert_text ---

async function handleInsertText(
  input: DocInsertTextInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocInsertTextOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);

  let insertOffset: number;
  let description: string;

  if (input.position.at === 'start') {
    insertOffset = 0;
    description = 'start of file';
  } else if (input.position.at === 'end') {
    insertOffset = content.length;
    description = 'end of file';
  } else {
    // Anchor-based positioning
    const anchor = input.position.before || input.position.after;
    if (!anchor) {
      return { success: false, error: 'Position must specify before, after, or at' };
    }

    const matchResult = findUniqueMatch(content, anchor, {
      caseSensitive: true,
      normalizeDiacritics: input.normalize_diacritics !== false,
    });

    if (!matchResult.found) {
      if (matchResult.count === 0) {
        return {
          success: false,
          error: `Anchor text not found in file. Make sure you are using exact text from your most recent read.`,
        };
      }
      return {
        success: false,
        error: `Multiple matches (${matchResult.count}) for anchor text. Include more context to make it unique.`,
      };
    }

    if (input.position.before) {
      insertOffset = matchResult.index;
      description = `before "${anchor.substring(0, 40)}${anchor.length > 40 ? '...' : ''}"`;
    } else {
      insertOffset = matchResult.index + matchResult.length;
      description = `after "${anchor.substring(0, 40)}${anchor.length > 40 ? '...' : ''}"`;
    }
  }

  const newContent =
    content.substring(0, insertOffset) +
    input.content +
    content.substring(insertOffset);

  const { mtime } = await writeFileWithMtimeCheck(resolved, newContent);

  await triggerReindexIfNeeded(resolved);

  const lineNumber = getLineNumber(newContent, insertOffset);

  const result: DocInsertTextOutput = {
    success: true,
    path: input.path,
    mtime,
    line_number: lineNumber,
  };

  return {
    success: true,
    result,
    formattedText: `Inserted text at ${description} (line ${lineNumber}) in ${input.path} (mtime: ${mtime}). Note: your previous read of this file is now stale.`,
  };
}

// --- doc_grep ---

async function handleGrep(
  input: DocGrepInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocGrepOutput; error?: string; formattedText?: string }> {
  if (!context.projectId) {
    return { success: false, error: 'Grep requires a project context' };
  }

  const maxResults = Math.min(input.max_results || 100, 500);
  const contextLines = input.context_lines || 0;
  const matches: DocGrepMatch[] = [];

  // Build search pattern
  let searchPattern: RegExp;
  try {
    if (input.is_regex) {
      searchPattern = new RegExp(input.query, input.case_sensitive ? 'g' : 'gi');
    } else {
      // Escape regex special chars for literal matching
      const escaped = input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      searchPattern = new RegExp(escaped, input.case_sensitive ? 'g' : 'gi');
    }
  } catch (err) {
    return { success: false, error: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Helper to search a single file
  const searchFile = async (
    absolutePath: string,
    displayPath: string,
    mountPointName?: string
  ): Promise<void> => {
    if (matches.length >= maxResults) return;
    if (!isTextFile(absolutePath)) return;

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');

      // For diacritics normalization, we need custom matching
      if (input.normalize_diacritics !== false && !input.is_regex) {
        const normalizedMatches = findAllMatches(content, input.query, {
          caseSensitive: input.case_sensitive ?? false,
          normalizeDiacritics: true,
        });

        const lines = content.split('\n');
        for (const match of normalizedMatches) {
          if (matches.length >= maxResults) break;
          const lineNum = getLineNumber(content, match.index);
          const lineIdx = lineNum - 1;

          const grepMatch: DocGrepMatch = {
            path: displayPath,
            mount_point: mountPointName,
            line_number: lineNum,
            match: lines[lineIdx] || '',
          };

          if (contextLines > 0) {
            grepMatch.context_before = lines.slice(Math.max(0, lineIdx - contextLines), lineIdx);
            grepMatch.context_after = lines.slice(lineIdx + 1, lineIdx + 1 + contextLines);
          }

          matches.push(grepMatch);
        }
      } else {
        // Regex-based search
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
          if (searchPattern.test(lines[i])) {
            searchPattern.lastIndex = 0; // Reset for global regex

            const grepMatch: DocGrepMatch = {
              path: displayPath,
              mount_point: mountPointName,
              line_number: i + 1,
              match: lines[i],
            };

            if (contextLines > 0) {
              grepMatch.context_before = lines.slice(Math.max(0, i - contextLines), i);
              grepMatch.context_after = lines.slice(i + 1, i + 1 + contextLines);
            }

            matches.push(grepMatch);
          }
          searchPattern.lastIndex = 0; // Reset for next line test
        }
      }
    } catch {
      // Skip files that can't be read
      logger.debug('Skipping unreadable file in grep', { path: absolutePath });
    }
  };

  // Walk a directory and search files
  const walkAndSearch = async (
    baseDir: string,
    displayPrefix: string,
    mountPointName?: string,
    folder?: string
  ): Promise<void> => {
    const startDir = folder ? path.join(baseDir, folder) : baseDir;

    try {
      const walkRecursive = async (dir: string): Promise<void> => {
        if (matches.length >= maxResults) return;

        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (matches.length >= maxResults) return;

          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(baseDir, fullPath);

          if (entry.isDirectory()) {
            // Skip hidden directories
            if (entry.name.startsWith('.')) continue;
            await walkRecursive(fullPath);
          } else if (entry.isFile()) {
            if (input.path && !relativePath.startsWith(input.path)) continue;
            const displayPath = displayPrefix ? `${displayPrefix}/${relativePath}` : relativePath;
            await searchFile(fullPath, displayPath, mountPointName);
          }
        }
      };

      await walkRecursive(startDir);
    } catch {
      logger.debug('Could not walk directory for grep', { dir: startDir });
    }
  };

  // Helper to search a blob of in-memory content (used for DB-backed stores
  // where bytes come from doc_mount_documents rather than the filesystem).
  const searchContent = (
    content: string,
    displayPath: string,
    mountPointName?: string
  ): void => {
    if (matches.length >= maxResults) return;
    if (input.normalize_diacritics !== false && !input.is_regex) {
      const normalizedMatches = findAllMatches(content, input.query, {
        caseSensitive: input.case_sensitive ?? false,
        normalizeDiacritics: true,
      });
      const lines = content.split('\n');
      for (const match of normalizedMatches) {
        if (matches.length >= maxResults) break;
        const lineNum = getLineNumber(content, match.index);
        const lineIdx = lineNum - 1;
        const grepMatch: DocGrepMatch = {
          path: displayPath,
          mount_point: mountPointName,
          line_number: lineNum,
          match: lines[lineIdx] || '',
        };
        if (contextLines > 0) {
          grepMatch.context_before = lines.slice(Math.max(0, lineIdx - contextLines), lineIdx);
          grepMatch.context_after = lines.slice(lineIdx + 1, lineIdx + 1 + contextLines);
        }
        matches.push(grepMatch);
      }
    } else {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
        if (searchPattern.test(lines[i])) {
          searchPattern.lastIndex = 0;
          const grepMatch: DocGrepMatch = {
            path: displayPath,
            mount_point: mountPointName,
            line_number: i + 1,
            match: lines[i],
          };
          if (contextLines > 0) {
            grepMatch.context_before = lines.slice(Math.max(0, i - contextLines), i);
            grepMatch.context_after = lines.slice(i + 1, i + 1 + contextLines);
          }
          matches.push(grepMatch);
        }
        searchPattern.lastIndex = 0;
      }
    }
  };

  // Search document store mount points
  if (!input.mount_point || input.mount_point) {
    const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
    const mountPoints = await getAccessibleMountPoints(context.projectId, context.characterId, peerCharacterIds);

    for (const mp of mountPoints) {
      if (input.mount_point && mp.name.toLowerCase() !== input.mount_point.toLowerCase() && mp.id !== input.mount_point) {
        continue;
      }
      if (mp.mountType === 'database') {
        const repos = getRepositories();
        const documents = await repos.docMountDocuments.findByMountPointId(mp.id);
        for (const doc of documents) {
          if (matches.length >= maxResults) break;
          if (input.path && !doc.relativePath.startsWith(input.path)) continue;
          searchContent(doc.content, doc.relativePath, mp.name);
        }
        continue;
      }
      await walkAndSearch(mp.basePath, '', mp.name);
    }
  }

  // Search project files
  if (!input.mount_point) {
    const { getFilesDir } = await import('@/lib/paths');
    const projectDir = path.join(getFilesDir(), context.projectId);
    try {
      await fs.access(projectDir);
      await walkAndSearch(projectDir, '[project]');
    } catch {
      // Project dir doesn't exist, skip
    }
  }

  const result: DocGrepOutput = {
    matches,
    total_matches: matches.length,
  };

  // Format for LLM
  if (matches.length === 0) {
    return {
      success: true,
      result,
      formattedText: `No matches found for "${input.query}"`,
    };
  }

  const formatted = matches.map(m => {
    const prefix = m.mount_point ? `[${m.mount_point}] ` : '';
    let text = `${prefix}${m.path}:${m.line_number}: ${m.match}`;
    if (m.context_before?.length) {
      text = m.context_before.map(l => `  ${l}`).join('\n') + '\n' + text;
    }
    if (m.context_after?.length) {
      text = text + '\n' + m.context_after.map(l => `  ${l}`).join('\n');
    }
    return text;
  }).join('\n\n');

  return {
    success: true,
    result,
    formattedText: `Found ${matches.length} matches for "${input.query}":\n\n${formatted}`,
  };
}

// --- doc_list_files ---

async function handleListFiles(
  input: DocListFilesInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocListFilesOutput; error?: string; formattedText?: string }> {
  if (!context.projectId) {
    return { success: false, error: 'List files requires a project context' };
  }

  const files: DocFileInfo[] = [];
  const recursive = input.recursive !== false;

  // Helper to check glob pattern match (simple implementation)
  const matchesGlob = (filename: string, pattern: string): boolean => {
    if (!pattern) return true;
    // Simple glob: *.ext matching
    if (pattern.startsWith('*.')) {
      return filename.endsWith(pattern.substring(1));
    }
    // Direct match
    return filename === pattern;
  };

  // Walk directory and collect file info
  const collectFiles = async (
    baseDir: string,
    scope: DocEditScope,
    mountPointName?: string,
    folder?: string
  ): Promise<void> => {
    const startDir = folder ? path.join(baseDir, folder) : baseDir;

    try {
      const walkRecursive = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(baseDir, fullPath);

          if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue; // Skip hidden dirs
            // Add folder entry
            files.push({
              path: relativePath,
              mount_point: mountPointName,
              scope,
              size: 0,
              modified: 0,
              kind: 'folder',
            });
            if (recursive) await walkRecursive(fullPath);
          } else if (entry.isFile()) {
            if (input.pattern && !matchesGlob(entry.name, input.pattern)) continue;

            try {
              const stat = await fs.stat(fullPath);
              files.push({
                path: relativePath,
                mount_point: mountPointName,
                scope,
                size: stat.size,
                modified: stat.mtime.getTime(),
                kind: 'file',
              });
            } catch {
              // Skip files we can't stat
            }
          }
        }
      };

      await walkRecursive(startDir);
    } catch {
      // Directory doesn't exist or can't be read
      logger.debug('Could not list directory', { dir: startDir });
    }
  };

  const shouldIncludeDocStore = !input.scope || input.scope === 'document_store';
  const shouldIncludeProject = !input.scope || input.scope === 'project';
  const shouldIncludeGeneral = !input.scope || input.scope === 'general';

  // List document store files
  if (shouldIncludeDocStore) {
    const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
    const mountPoints = await getAccessibleMountPoints(context.projectId, context.characterId, peerCharacterIds);
    for (const mp of mountPoints) {
      if (input.mount_point && mp.name.toLowerCase() !== input.mount_point.toLowerCase() && mp.id !== input.mount_point) {
        continue;
      }
      if (mp.mountType === 'database') {
        // Bytes live in doc_mount_documents; list from the mirror doc_mount_files rows.
        const dbEntries = await listDatabaseFiles(mp.id, input.folder ? { folder: input.folder } : {});
        for (const entry of dbEntries) {
          if (input.pattern && !matchesGlob(entry.fileName, input.pattern)) continue;
          files.push({
            path: entry.relativePath,
            mount_point: mp.name,
            scope: 'document_store',
            size: entry.fileSizeBytes,
            modified: new Date(entry.lastModified).getTime(),
            kind: entry.kind as 'file' | 'folder' | undefined,
          });
        }
        continue;
      }
      await collectFiles(mp.basePath, 'document_store', mp.name, input.folder);
    }
  }

  // List project files
  if (shouldIncludeProject) {
    const { getFilesDir } = await import('@/lib/paths');
    const projectDir = path.join(getFilesDir(), context.projectId);
    await collectFiles(projectDir, 'project', undefined, input.folder);
  }

  // List general files
  if (shouldIncludeGeneral) {
    const { getFilesDir } = await import('@/lib/paths');
    const generalDir = path.join(getFilesDir(), '_general');
    await collectFiles(generalDir, 'general', undefined, input.folder);
  }

  const result: DocListFilesOutput = {
    files,
    total: files.length,
  };

  // Format for LLM
  if (files.length === 0) {
    return {
      success: true,
      result,
      formattedText: 'No files found.',
    };
  }

  const formatted = files.map(f => {
    const prefix = f.mount_point ? `[${f.mount_point}] ` : `[${f.scope}] `;
    if (f.kind === 'folder') {
      return `${prefix}[folder] ${f.path}`;
    }
    const sizeStr = f.size < 1024 ? `${f.size}B` : f.size < 1048576 ? `${(f.size / 1024).toFixed(1)}KB` : `${(f.size / 1048576).toFixed(1)}MB`;
    return `${prefix}${f.path}  (${sizeStr})`;
  }).join('\n');

  return {
    success: true,
    result,
    formattedText: `${files.length} files:\n\n${formatted}`,
  };
}

// ============================================================================
// Tier 2: Markdown-Aware Handlers
// ============================================================================

// --- doc_read_frontmatter ---

async function handleReadFrontmatter(
  input: DocReadFrontmatterInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocReadFrontmatterOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildReadResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);
  const parsed = parseFrontmatter(content);

  if (parsed.data === null) {
    return {
      success: true,
      result: { frontmatter: null, path: input.path },
      formattedText: `No frontmatter found in ${input.path}`,
    };
  }

  // Filter to specific keys if requested
  let frontmatter = parsed.data;
  if (input.keys && input.keys.length > 0) {
    const filtered: Record<string, unknown> = {};
    for (const key of input.keys) {
      if (key in frontmatter) {
        filtered[key] = frontmatter[key];
      }
    }
    frontmatter = filtered;
  }

  const result: DocReadFrontmatterOutput = {
    frontmatter,
    path: input.path,
  };

  return {
    success: true,
    result,
    formattedText: `Frontmatter from ${input.path}:\n\n${JSON.stringify(frontmatter, null, 2)}`,
  };
}

// --- doc_update_frontmatter ---

async function handleUpdateFrontmatter(
  input: DocUpdateFrontmatterInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocUpdateFrontmatterOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);

  const newContent = updateFrontmatterInContent(
    content,
    input.updates,
    input.replace_all ?? false
  );

  const { mtime } = await writeFileWithMtimeCheck(resolved, newContent);

  await triggerReindexIfNeeded(resolved);

  const result: DocUpdateFrontmatterOutput = {
    success: true,
    path: input.path,
    mtime,
  };

  const action = input.replace_all ? 'Replaced' : 'Updated';
  const keyCount = Object.keys(input.updates).length;

  return {
    success: true,
    result,
    formattedText: `${action} frontmatter in ${input.path} (${keyCount} keys, mtime: ${mtime})`,
  };
}

// --- doc_read_heading ---

async function handleReadHeading(
  input: DocReadHeadingInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocReadHeadingOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildReadResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);

  try {
    const heading = findHeadingSection(content, input.heading, input.level);
    const sectionContent = readHeadingContent(content, heading);

    const result: DocReadHeadingOutput = {
      content: sectionContent,
      heading: heading.text,
      level: heading.level,
      path: input.path,
    };

    return {
      success: true,
      result,
      formattedText: `Content under "${'#'.repeat(heading.level)} ${heading.text}" in ${input.path}:\n\n${sectionContent}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// --- doc_update_heading ---

async function handleUpdateHeading(
  input: DocUpdateHeadingInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocUpdateHeadingOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  if (!isTextFile(resolved.relativePath)) {
    return { success: false, error: `File is not a supported text format: ${input.path}` };
  }

  const { content } = await readFileWithMtime(resolved);

  try {
    const heading = findHeadingSection(content, input.heading, input.level);
    const newContent = replaceHeadingContent(
      content,
      heading,
      input.content,
      input.preserve_subheadings !== false
    );

    const { mtime } = await writeFileWithMtimeCheck(resolved, newContent);

    await triggerReindexIfNeeded(resolved);

    const result: DocUpdateHeadingOutput = {
      success: true,
      path: input.path,
      mtime,
    };

    return {
      success: true,
      result,
      formattedText: `Updated content under "${'#'.repeat(heading.level)} ${heading.text}" in ${input.path} (mtime: ${mtime}). Note: your previous read of this file is now stale.`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Tier 3: File Management Handlers (Scriptorium Phase 3.4)
// ============================================================================

// --- doc_move_file ---

async function handleMoveFile(
  input: DocMoveFileInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocMoveFileOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;

  // Resolve source path
  const writeContext = await buildWriteResolutionContext(input, context);
  const resolvedSource = await resolveDocEditPath(scope, input.path, writeContext);
  const resolvedDest = await resolveDocEditPath(scope, input.new_path, writeContext);

  // Database-backed mount: route move through the database-store module.
  if (resolvedSource.mountType === 'database' && resolvedSource.mountPointId) {
    if (!await databaseDocumentExists(resolvedSource.mountPointId, resolvedSource.relativePath)) {
      if (await databaseFolderExists(resolvedSource.mountPointId, resolvedSource.relativePath)) {
        return { success: false, error: `Path is a folder, not a file: ${input.path}. Use doc_move_folder to rename or move folders.` };
      }
      return { success: false, error: `Source file not found: ${input.path}` };
    }
    if (await databaseDocumentExists(resolvedSource.mountPointId, resolvedDest.relativePath)) {
      return { success: false, error: `Destination already exists: ${input.new_path}. Move will not overwrite existing files.` };
    }
    await moveDatabaseDocument(
      resolvedSource.mountPointId,
      resolvedSource.relativePath,
      resolvedDest.relativePath
    );
    logger.info('Moved database document', {
      from: input.path,
      to: input.new_path,
      scope,
    });
    return {
      success: true,
      result: { success: true, old_path: input.path, new_path: input.new_path },
      formattedText: `Moved: ${input.path} → ${input.new_path}`,
    };
  }

  // Verify source exists and is a file
  try {
    const stat = await fs.stat(resolvedSource.absolutePath);
    if (!stat.isFile()) {
      return { success: false, error: `Source path is not a file: ${input.path}` };
    }
  } catch {
    return { success: false, error: `Source file not found: ${input.path}` };
  }

  // Check destination doesn't already exist
  try {
    await fs.access(resolvedDest.absolutePath);
    return { success: false, error: `Destination already exists: ${input.new_path}. Move will not overwrite existing files.` };
  } catch {
    // Good — destination doesn't exist
  }

  // Ensure parent directory of destination exists
  const destParent = path.dirname(resolvedDest.absolutePath);
  await fs.mkdir(destParent, { recursive: true });

  // Perform the move
  await fs.rename(resolvedSource.absolutePath, resolvedDest.absolutePath);

  logger.info('Moved file', {
    from: input.path,
    to: input.new_path,
    scope,
  });

  // Trigger re-indexing for the new path if in document_store
  if (resolvedSource.scope === 'document_store' && resolvedSource.mountPointId) {
    reindexSingleFile(resolvedSource.mountPointId, resolvedDest.relativePath, resolvedDest.absolutePath)
      .catch(err => {
        logger.warn('Background re-index failed for moved file', {
          path: resolvedDest.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  const result: DocMoveFileOutput = {
    success: true,
    old_path: input.path,
    new_path: input.new_path,
  };

  return {
    success: true,
    result,
    formattedText: `Moved: ${input.path} → ${input.new_path}`,
  };
}

// --- doc_copy_file ---

/**
 * Given a resolved destination and the source basename, decide whether the
 * destination points at an existing directory. If it does, the file should
 * be copied into that directory under its source filename. Otherwise the
 * resolved path is treated as the final file path (parent dirs auto-created).
 *
 * Returns the final relative path to use for the destination write.
 */
async function resolveCopyDestination(
  resolvedDest: ResolvedPath,
  destRelInput: string,
  sourceBasename: string
): Promise<string> {
  const normalised = destRelInput.trim();
  if (normalised === '' || normalised === '.' || normalised === '/' || normalised === './') {
    return sourceBasename;
  }

  // Detect directory at the resolved destination.
  let destIsDirectory = false;
  if (resolvedDest.mountType === 'database' && resolvedDest.mountPointId) {
    destIsDirectory = await databaseFolderExists(
      resolvedDest.mountPointId,
      resolvedDest.relativePath
    );
  } else if (resolvedDest.absolutePath) {
    try {
      const stat = await fs.stat(resolvedDest.absolutePath);
      destIsDirectory = stat.isDirectory();
    } catch {
      destIsDirectory = false;
    }
  }

  if (destIsDirectory) {
    // Use posix join so the stored relative path stays forward-slash style,
    // matching the rest of the doc-edit layer.
    const joined = path.posix.join(resolvedDest.relativePath.split(path.sep).join('/'), sourceBasename);
    return joined;
  }

  return resolvedDest.relativePath;
}

async function handleCopyFile(
  input: DocCopyFileInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocCopyFileOutput; error?: string; formattedText?: string }> {
  // Text-only guard, to mirror doc_write_file / doc_read_file semantics.
  if (!isTextFile(input.source_path)) {
    return {
      success: false,
      error: `doc_copy_file supports text files only. For binary assets (images, PDFs, etc.), use the blob family of tools.`,
    };
  }

  // Resolve source (read context — peer vaults may be readable in shared chats)
  // and destination (write context — peer vaults are never writable).
  const readContext = await buildReadResolutionContext(
    { mount_point: input.source_mount_point },
    context
  );
  const writeContext = await buildWriteResolutionContext(
    { mount_point: input.dest_mount_point },
    context
  );

  const resolvedSource = await resolveDocEditPath('document_store', input.source_path, readContext);

  // Initial destination resolve is against the raw dest_path; we re-resolve
  // below once we know whether to append the source basename.
  const destRelInput = input.dest_path ?? '';
  const initialDestRel = destRelInput.trim() === '' || destRelInput.trim() === '/' ? '.' : destRelInput;
  const initialResolvedDest = await resolveDocEditPath('document_store', initialDestRel, writeContext);

  // Same-store guard: compare by mountPointId, which is the authoritative
  // identifier after lookup collapses name-vs-id inputs.
  if (
    resolvedSource.mountPointId &&
    initialResolvedDest.mountPointId &&
    resolvedSource.mountPointId === initialResolvedDest.mountPointId
  ) {
    return {
      success: false,
      error: `doc_copy_file requires source and destination to be different document stores. Both resolved to "${resolvedSource.mountPointName ?? resolvedSource.mountPointId}".`,
    };
  }

  const sourceBasename = path.posix.basename(input.source_path.split(path.sep).join('/'));
  const finalDestRel = await resolveCopyDestination(initialResolvedDest, destRelInput, sourceBasename);

  // Re-resolve with the final relative path so downstream existence checks,
  // reindex, and write all see the true destination.
  const resolvedDest = await resolveDocEditPath('document_store', finalDestRel, writeContext);

  // Verify source exists and is a file (not a folder).
  if (resolvedSource.mountType === 'database' && resolvedSource.mountPointId) {
    if (!(await databaseDocumentExists(resolvedSource.mountPointId, resolvedSource.relativePath))) {
      if (await databaseFolderExists(resolvedSource.mountPointId, resolvedSource.relativePath)) {
        return { success: false, error: `Source path is a folder, not a file: ${input.source_path}.` };
      }
      return { success: false, error: `Source file not found: ${input.source_path}` };
    }
  } else {
    try {
      const stat = await fs.stat(resolvedSource.absolutePath);
      if (!stat.isFile()) {
        return { success: false, error: `Source path is not a file: ${input.source_path}` };
      }
    } catch {
      return { success: false, error: `Source file not found: ${input.source_path}` };
    }
  }

  // Refuse to overwrite — match doc_move_file semantics.
  if (resolvedDest.mountType === 'database' && resolvedDest.mountPointId) {
    if (await databaseDocumentExists(resolvedDest.mountPointId, resolvedDest.relativePath)) {
      return {
        success: false,
        error: `Destination already exists: ${finalDestRel}. Copy will not overwrite existing files; delete it first if you want to replace it.`,
      };
    }
    if (await databaseFolderExists(resolvedDest.mountPointId, resolvedDest.relativePath)) {
      return {
        success: false,
        error: `Destination path ${finalDestRel} resolves to a folder, not a file location.`,
      };
    }
  } else if (resolvedDest.absolutePath) {
    try {
      const stat = await fs.stat(resolvedDest.absolutePath);
      if (stat.isDirectory()) {
        return {
          success: false,
          error: `Destination path ${finalDestRel} resolves to a folder, not a file location.`,
        };
      }
      return {
        success: false,
        error: `Destination already exists: ${finalDestRel}. Copy will not overwrite existing files; delete it first if you want to replace it.`,
      };
    } catch {
      // Good — destination does not exist.
    }
  }

  // Read the source content (both filesystem + database sources handled inside).
  const { content } = await readFileWithMtime(resolvedSource);

  // Write to the destination. writeFileWithMtimeCheck creates parent folders
  // on filesystem mounts and ensures folder rows on database mounts.
  const { mtime } = await writeFileWithMtimeCheck(resolvedDest, content);

  logger.info('Copied document', {
    source_mount_point: resolvedSource.mountPointName,
    source_path: input.source_path,
    dest_mount_point: resolvedDest.mountPointName,
    dest_path: finalDestRel,
    bytes: content.length,
  });

  await triggerReindexIfNeeded(resolvedDest);

  const result: DocCopyFileOutput = {
    success: true,
    source_mount_point: resolvedSource.mountPointName ?? input.source_mount_point,
    source_path: input.source_path,
    dest_mount_point: resolvedDest.mountPointName ?? input.dest_mount_point,
    dest_path: finalDestRel,
    mtime,
  };

  return {
    success: true,
    result,
    formattedText: `Copied: ${resolvedSource.mountPointName ?? input.source_mount_point}:${input.source_path} → ${resolvedDest.mountPointName ?? input.dest_mount_point}:${finalDestRel}`,
  };
}

// --- doc_delete_file ---

/**
 * Resolve the LibrarianActorOrigin for a tool call. Characters are preferred;
 * if the context has no characterId or the lookup fails, falls back to user
 * attribution — matches the pattern in handleOpenDocument.
 */
async function resolveActorOrigin(context: DocEditToolContext): Promise<LibrarianActorOrigin> {
  if (!context.characterId) return { kind: 'by-user' };
  try {
    const repos = getRepositories();
    const character = await repos.characters.findById(context.characterId);
    if (character?.name) {
      return { kind: 'by-character', characterName: character.name };
    }
  } catch (error) {
    logger.debug('Could not resolve character name for Librarian attribution', {
      characterId: context.characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { kind: 'by-user' };
}

async function handleDeleteFile(
  input: DocDeleteFileInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocDeleteFileOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  // Database-backed mount: route delete through the database-store module.
  if (resolved.mountType === 'database' && resolved.mountPointId) {
    const deleted = await deleteDatabaseDocument(resolved.mountPointId, resolved.relativePath);
    if (!deleted) {
      if (await databaseFolderExists(resolved.mountPointId, resolved.relativePath)) {
        return { success: false, error: `Path is a folder, not a file: ${input.path}. Use doc_delete_folder to remove folders.` };
      }
      return { success: false, error: `File not found: ${input.path}` };
    }
    logger.info('Deleted database document', { path: input.path, scope });
    await postLibrarianDeleteAnnouncement({
      chatId: context.chatId,
      displayTitle: path.basename(input.path),
      filePath: input.path,
      scope: scope as 'project' | 'document_store' | 'general',
      mountPoint: input.mount_point,
      origin: await resolveActorOrigin(context),
    });
    return {
      success: true,
      result: { success: true, path: input.path },
      formattedText: `Deleted file: ${input.path}`,
    };
  }

  // Verify the file exists and is a file
  try {
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) {
      return { success: false, error: `Path is not a file: ${input.path}` };
    }
  } catch {
    return { success: false, error: `File not found: ${input.path}` };
  }

  // Delete the file
  await fs.unlink(resolved.absolutePath);

  logger.info('Deleted file', {
    path: input.path,
    scope,
  });

  await postLibrarianDeleteAnnouncement({
    chatId: context.chatId,
    displayTitle: path.basename(input.path),
    filePath: input.path,
    scope: scope as 'project' | 'document_store' | 'general',
    mountPoint: input.mount_point,
    origin: await resolveActorOrigin(context),
  });

  const result: DocDeleteFileOutput = {
    success: true,
    path: input.path,
  };

  return {
    success: true,
    result,
    formattedText: `Deleted file: ${input.path}`,
  };
}

// --- doc_create_folder ---

async function handleCreateFolder(
  input: DocCreateFolderInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocCreateFolderOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  // Database-backed mounts: create explicit folder rows
  if (resolved.mountType === 'database' && resolved.mountPointId) {
    try {
      await createDatabaseFolder(resolved.mountPointId, resolved.relativePath);
      logger.info('Created database folder', { path: input.path, scope });
      await postLibrarianFolderCreatedAnnouncement({
        chatId: context.chatId,
        folderPath: input.path,
        scope: scope as 'project' | 'document_store' | 'general',
        mountPoint: input.mount_point,
        origin: await resolveActorOrigin(context),
      });
      return {
        success: true,
        result: { success: true, path: input.path },
        formattedText: `Created folder: ${input.path}`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  // Create the directory (recursive, idempotent)
  await fs.mkdir(resolved.absolutePath, { recursive: true });

  logger.info('Created folder', {
    path: input.path,
    scope,
  });

  await postLibrarianFolderCreatedAnnouncement({
    chatId: context.chatId,
    folderPath: input.path,
    scope: scope as 'project' | 'document_store' | 'general',
    mountPoint: input.mount_point,
    origin: await resolveActorOrigin(context),
  });

  const result: DocCreateFolderOutput = {
    success: true,
    path: input.path,
  };

  return {
    success: true,
    result,
    formattedText: `Created folder: ${input.path}`,
  };
}

// --- doc_delete_folder ---

async function handleDeleteFolder(
  input: DocDeleteFolderInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocDeleteFolderOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));

  // Database-backed mount: delete explicit folder rows
  if (resolved.mountType === 'database' && resolved.mountPointId) {
    try {
      await deleteDatabaseFolder(resolved.mountPointId, resolved.relativePath);
      logger.info('Deleted database folder', { path: input.path, scope });
      await postLibrarianFolderDeletedAnnouncement({
        chatId: context.chatId,
        folderPath: input.path,
        scope: scope as 'project' | 'document_store' | 'general',
        mountPoint: input.mount_point,
        origin: await resolveActorOrigin(context),
      });
      return {
        success: true,
        result: { success: true, path: input.path },
        formattedText: `Deleted folder: ${input.path}`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('not empty')) {
        return {
          success: false,
          error: `Folder is not empty: ${input.path}. Only empty folders can be deleted. Use doc_list_files to see the contents.`,
          formattedText: `Error: Folder "${input.path}" is not empty. Only empty folders can be deleted.`,
        };
      }
      if (errorMsg.toLowerCase().includes('not found')) {
        if (await databaseDocumentExists(resolved.mountPointId, resolved.relativePath)) {
          return { success: false, error: `Path is a file, not a folder: ${input.path}. Use doc_delete_file to delete files.` };
        }
      }
      return { success: false, error: errorMsg };
    }
  }

  // Verify the path exists and is a directory
  try {
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isDirectory()) {
      return { success: false, error: `Path is not a folder: ${input.path}` };
    }
  } catch {
    return { success: false, error: `Folder not found: ${input.path}` };
  }

  // Check that the directory is empty
  const entries = await fs.readdir(resolved.absolutePath);
  if (entries.length > 0) {
    return {
      success: false,
      error: `Folder is not empty: ${input.path} (contains ${entries.length} item${entries.length === 1 ? '' : 's'}). Only empty folders can be deleted. Use doc_list_files to see the contents.`,
      formattedText: `Error: Folder "${input.path}" is not empty (${entries.length} item${entries.length === 1 ? '' : 's'}). Only empty folders can be deleted.`,
    };
  }

  // Delete the empty directory
  await fs.rmdir(resolved.absolutePath);

  logger.info('Deleted folder', {
    path: input.path,
    scope,
  });

  await postLibrarianFolderDeletedAnnouncement({
    chatId: context.chatId,
    folderPath: input.path,
    scope: scope as 'project' | 'document_store' | 'general',
    mountPoint: input.mount_point,
    origin: await resolveActorOrigin(context),
  });

  const result: DocDeleteFolderOutput = {
    success: true,
    path: input.path,
  };

  return {
    success: true,
    result,
    formattedText: `Deleted folder: ${input.path}`,
  };
}

// --- doc_move_folder ---

async function handleMoveFolder(
  input: DocMoveFolderInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocMoveFolderOutput; error?: string; formattedText?: string }> {
  const scope = (input.scope || 'document_store') as DocEditScope;

  // Resolve source path
  const writeContext = await buildWriteResolutionContext(input, context);
  const resolvedSource = await resolveDocEditPath(scope, input.path, writeContext);
  const resolvedDest = await resolveDocEditPath(scope, input.new_path, writeContext);

  // Database-backed mount: route move through the database-store module
  if (resolvedSource.mountType === 'database' && resolvedSource.mountPointId) {
    try {
      await moveDatabaseFolder(
        resolvedSource.mountPointId,
        resolvedSource.relativePath,
        resolvedDest.relativePath
      );
      logger.info('Moved database folder', {
        from: input.path,
        to: input.new_path,
        scope,
      });
      return {
        success: true,
        result: { success: true, old_path: input.path, new_path: input.new_path },
        formattedText: `Moved folder: ${input.path} → ${input.new_path}`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.toLowerCase().includes('not found')) {
        if (await databaseDocumentExists(resolvedSource.mountPointId, resolvedSource.relativePath)) {
          return { success: false, error: `Source path is a file, not a folder: ${input.path}. Use doc_move_file to rename or move files.` };
        }
      }
      return { success: false, error: errorMsg };
    }
  }

  // Filesystem mount: use fs.rename
  try {
    const sourceStat = await fs.stat(resolvedSource.absolutePath);
    if (!sourceStat.isDirectory()) {
      return { success: false, error: `Source path is not a folder: ${input.path}` };
    }
  } catch {
    return { success: false, error: `Source folder not found: ${input.path}` };
  }

  // Check destination doesn't already exist
  try {
    await fs.access(resolvedDest.absolutePath);
    return { success: false, error: `Destination already exists: ${input.new_path}. Move will not overwrite existing folders.` };
  } catch {
    // Good — destination doesn't exist
  }

  // Ensure parent directory of destination exists
  const destParent = path.dirname(resolvedDest.absolutePath);
  await fs.mkdir(destParent, { recursive: true });

  // Perform the move
  await fs.rename(resolvedSource.absolutePath, resolvedDest.absolutePath);

  logger.info('Moved folder', {
    from: input.path,
    to: input.new_path,
    scope,
  });

  const result: DocMoveFolderOutput = {
    success: true,
    old_path: input.path,
    new_path: input.new_path,
  };

  return {
    success: true,
    result,
    formattedText: `Moved folder: ${input.path} → ${input.new_path}`,
  };
}

// ============================================================================
// Document UI Tools (Phase 3.5)
// ============================================================================

/**
 * Handle doc_open_document: open a document in the split-panel editor.
 * This is a UI tool — it writes to the chat_documents table and returns
 * a structured response that the frontend interprets to open the editor pane.
 */
async function handleOpenDocument(
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
      logger.debug('Could not resolve character name for Librarian attribution', {
        characterId: context.characterId,
        error: error instanceof Error ? error.message : String(error),
      });
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
async function handleCloseDocument(
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
async function handleDocFocus(
  input: DocFocusInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: unknown; error?: string; formattedText?: string }> {
  logger.debug('doc_focus requested', { chatId: context.chatId, ...input });

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

// ============================================================================
// Blob Tools (database-backed + universal blob layer)
// ============================================================================

async function resolveBlobMountPointForRead(
  mountPointRef: string,
  context: DocEditToolContext
): Promise<{ id: string; name: string } | null> {
  if (!context.projectId && !context.characterId) return null;
  const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
  const mountPoints = await getAccessibleMountPoints(context.projectId, context.characterId, peerCharacterIds);
  const needle = mountPointRef.toLowerCase();
  const found = mountPoints.find(
    mp => mp.name.toLowerCase() === needle || mp.id === mountPointRef
  );
  return found ? { id: found.id, name: found.name } : null;
}

async function resolveBlobMountPointForWrite(
  mountPointRef: string,
  context: DocEditToolContext
): Promise<{ id: string; name: string } | null> {
  if (!context.projectId && !context.characterId) return null;
  const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
  // Writes must not land in a peer's vault — raise the dedicated read-only error
  // before we even enumerate accessible mounts.
  await assertWriteDoesNotTargetPeerVault(mountPointRef, peerCharacterIds);
  const mountPoints = await getAccessibleMountPoints(context.projectId, context.characterId);
  const needle = mountPointRef.toLowerCase();
  const found = mountPoints.find(
    mp => mp.name.toLowerCase() === needle || mp.id === mountPointRef
  );
  return found ? { id: found.id, name: found.name } : null;
}

async function handleWriteBlob(
  input: DocWriteBlobInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocWriteBlobOutput; error?: string; formattedText?: string }> {
  const mp = await resolveBlobMountPointForWrite(input.mount_point, context);
  if (!mp) {
    return { success: false, error: `Mount point not found or not linked to this project: ${input.mount_point}` };
  }
  let rawBytes: Buffer;
  try {
    rawBytes = Buffer.from(input.data_base64, 'base64');
  } catch (err) {
    return { success: false, error: `Invalid base64 payload: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (rawBytes.length === 0) {
    return { success: false, error: 'Empty blob payload' };
  }

  const transcoded = await transcodeToWebP(rawBytes, input.mime_type);
  const finalPath = normaliseBlobRelativePath(input.path, transcoded.storedMimeType);

  const repos = getRepositories();
  const stored = await repos.docMountBlobs.create({
    mountPointId: mp.id,
    relativePath: finalPath,
    originalFileName: input.original_filename,
    originalMimeType: input.mime_type,
    storedMimeType: transcoded.storedMimeType,
    sha256: transcoded.sha256,
    description: input.description ?? '',
    data: transcoded.data,
  });

  logger.info('Stored blob', {
    mountPointId: mp.id,
    relativePath: stored.relativePath,
    storedMimeType: stored.storedMimeType,
    sizeBytes: stored.sizeBytes,
  });

  const result: DocWriteBlobOutput = {
    success: true,
    mount_point: mp.name,
    relative_path: stored.relativePath,
    size_bytes: stored.sizeBytes,
    stored_mime_type: stored.storedMimeType,
    sha256: stored.sha256,
  };
  return {
    success: true,
    result,
    formattedText: `Uploaded blob to [${mp.name}] ${stored.relativePath} (${stored.sizeBytes} bytes, ${stored.storedMimeType})`,
  };
}

async function handleReadBlob(
  input: DocReadBlobInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocReadBlobOutput; error?: string; formattedText?: string }> {
  const mp = await resolveBlobMountPointForRead(input.mount_point, context);
  if (!mp) {
    return { success: false, error: `Mount point not found or not linked to this project: ${input.mount_point}` };
  }
  const repos = getRepositories();
  const meta = await repos.docMountBlobs.findByMountPointAndPath(mp.id, input.path);
  if (!meta) {
    return { success: false, error: `Blob not found: ${input.path}` };
  }

  const result: DocReadBlobOutput = {
    mount_point: mp.name,
    relative_path: meta.relativePath,
    original_filename: meta.originalFileName,
    original_mime_type: meta.originalMimeType,
    stored_mime_type: meta.storedMimeType,
    size_bytes: meta.sizeBytes,
    sha256: meta.sha256,
    description: meta.description,
  };

  if (input.include_bytes) {
    const data = await repos.docMountBlobs.readData(meta.id);
    if (data) {
      result.data_base64 = data.toString('base64');
    }
  }

  return {
    success: true,
    result,
    formattedText: `Blob [${mp.name}] ${meta.relativePath} — ${meta.storedMimeType}, ${meta.sizeBytes} bytes${meta.description ? `\nDescription: ${meta.description}` : ''}`,
  };
}

async function handleListBlobs(
  input: DocListBlobsInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocListBlobsOutput; error?: string; formattedText?: string }> {
  const mp = await resolveBlobMountPointForRead(input.mount_point, context);
  if (!mp) {
    return { success: false, error: `Mount point not found or not linked to this project: ${input.mount_point}` };
  }
  const repos = getRepositories();
  const metas = await repos.docMountBlobs.listByMountPoint(
    mp.id,
    input.folder ? { folder: input.folder } : {}
  );
  const result: DocListBlobsOutput = {
    mount_point: mp.name,
    blobs: metas.map(m => ({
      relative_path: m.relativePath,
      original_filename: m.originalFileName,
      original_mime_type: m.originalMimeType,
      stored_mime_type: m.storedMimeType,
      size_bytes: m.sizeBytes,
      description: m.description,
    })),
    total: metas.length,
  };
  const formatted = metas.length === 0
    ? `No blobs in [${mp.name}]${input.folder ? ` under ${input.folder}` : ''}.`
    : `${metas.length} blobs in [${mp.name}]:\n` +
      metas.map(m => `  ${m.relativePath}  (${m.storedMimeType}, ${m.sizeBytes} bytes)${m.description ? `  — ${m.description}` : ''}`).join('\n');
  return { success: true, result, formattedText: formatted };
}

async function handleDeleteBlob(
  input: DocDeleteBlobInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocDeleteBlobOutput; error?: string; formattedText?: string }> {
  const mp = await resolveBlobMountPointForWrite(input.mount_point, context);
  if (!mp) {
    return { success: false, error: `Mount point not found or not linked to this project: ${input.mount_point}` };
  }
  const repos = getRepositories();
  const deleted = await repos.docMountBlobs.deleteByMountPointAndPath(mp.id, input.path);
  if (!deleted) {
    return { success: false, error: `Blob not found: ${input.path}` };
  }
  logger.info('Deleted blob', { mountPointId: mp.id, relativePath: input.path });
  const result: DocDeleteBlobOutput = {
    success: true,
    mount_point: mp.name,
    relative_path: input.path,
  };
  return { success: true, result, formattedText: `Deleted blob [${mp.name}] ${input.path}` };
}
