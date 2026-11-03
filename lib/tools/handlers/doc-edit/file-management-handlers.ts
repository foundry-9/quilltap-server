/**
 * File management tool handlers for the doc-edit handler group.
 *
 * Covers: doc_move_file, doc_copy_file, doc_delete_file, doc_create_folder,
 * doc_delete_folder, doc_move_folder — plus the sync and resolution helpers
 * they share internally.
 *
 * @module tools/handlers/doc-edit/file-management-handlers
 */

import path from 'path';
import fs from 'fs/promises';
import {
  resolveDocEditPath,
  isTextFile,
  parseQtapUri,
  type DocEditScope,
  type ResolvedPath,
} from '@/lib/doc-edit';
import type { DocMoveFileInput, DocMoveFileOutput } from '../../doc-move-file-tool';
import type { DocCopyFileInput, DocCopyFileOutput } from '../../doc-copy-file-tool';
import type { DocDeleteFileInput, DocDeleteFileOutput } from '../../doc-delete-file-tool';
import type { DocCreateFolderInput, DocCreateFolderOutput } from '../../doc-create-folder-tool';
import type { DocDeleteFolderInput, DocDeleteFolderOutput } from '../../doc-delete-folder-tool';
import type { DocMoveFolderInput, DocMoveFolderOutput } from '../../doc-move-folder-tool';
import { getRepositories } from '@/lib/repositories/factory';
import {
  databaseDocumentExists,
  createDatabaseFolder,
  deleteDatabaseFolder,
  moveDatabaseFolder,
} from '@/lib/mount-index/database-store';
import {
  postLibrarianDeleteAnnouncement,
  postLibrarianFolderCreatedAnnouncement,
  postLibrarianFolderDeletedAnnouncement,
  postLibrarianMoveAnnouncement,
  postLibrarianCopyAnnouncement,
  documentHiddenFromCharacters,
} from '@/lib/services/librarian-notifications/writer';
import {
  readDocument,
  writeDocument,
  statDocument,
  renameDocument,
  deleteDocument,
  sweepChatDocumentsAfterMove,
} from '@/lib/documents/core';
import {
  logger,
  type DocEditToolContext,
  applyQtapUriToInput,
  buildReadResolutionContext,
  buildWriteResolutionContext,
  resolveActorOrigin,
  uriForResolvedPath,
  assertCharacterMayRead,
  assertCharacterMayWrite,
  assertFolderHasNoWriteProtectedDescendants,
  publishedMountPoint,
} from './shared';

/**
 * Folder-level counterpart to the core's `sweepChatDocumentsAfterMove`. Rewrites the
 * `oldFolderPath/` prefix on any chat_documents row in the same store so a
 * file open under that folder follows the rename instead of going stale.
 */
async function syncChatDocumentsAfterFolderMove(
  scope: DocEditScope,
  mountPoint: string | undefined,
  oldFolderPath: string,
  newFolderPath: string,
): Promise<void> {
  try {
    const updated = await getRepositories().chatDocuments.renameFolderPathInStore(
      scope,
      mountPoint ?? null,
      oldFolderPath,
      newFolderPath,
    );
    if (updated > 0) {
      logger.info('Synced chat_documents after folder move', {
        scope,
        mountPoint,
        from: oldFolderPath,
        to: newFolderPath,
        rowsUpdated: updated,
      });
    }
  } catch (error) {
    logger.warn('Failed to sync chat_documents after folder move', {
      scope,
      mountPoint,
      from: oldFolderPath,
      to: newFolderPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// --- doc_move_file ---

export async function handleMoveFile(
  rawInput: DocMoveFileInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocMoveFileOutput; error?: string; formattedText?: string }> {
  const input = applyQtapUriToInput(rawInput);
  if (typeof input.path !== 'string') {
    return { success: false, error: 'A `path` (or `uri`) for the source is required.' };
  }
  const scope = (input.scope || 'document_store') as DocEditScope;

  // Resolve source path
  const writeContext = await buildWriteResolutionContext(input, context);
  const resolvedSource = await resolveDocEditPath(scope, input.path, writeContext);
  const resolvedDest = await resolveDocEditPath(scope, input.new_path, writeContext);

  // A move removes the source path — gate it by character_write. The
  // destination is gated too in case it would overwrite a protected file
  // (assertCharacterMayWrite is a no-op when the destination doesn't exist yet).
  await assertCharacterMayWrite(resolvedSource, context);
  await assertCharacterMayWrite(resolvedDest, context);

  // Capture the source's read-policy before the move relocates its link, so a
  // character_read:false document isn't announced to characters (operator path).
  const hiddenFromCharacters = await documentHiddenFromCharacters(
    resolvedSource.mountPointId,
    resolvedSource.relativePath,
  );

  // The core checks the source and the destination, moves the link row or
  // the file, and refreshes a moved file on disk.
  const moved = await renameDocument(resolvedSource, resolvedDest);
  if (!moved.ok) {
    switch (moved.reason) {
      case 'source-missing':
        return { success: false, error: `Source file not found: ${input.path}` };
      case 'source-not-a-file':
        return { success: false, error: `Path is a folder, not a file: ${input.path}. Use doc_move_folder to rename or move folders.` };
      case 'destination-taken':
        return { success: false, error: `Destination already exists: ${input.new_path}. Move will not overwrite existing files.` };
    }
  }

  // Keep any chat's Document Mode pointer on the file, under the store name
  // the rows were recorded with (never a caller's `self`, bug 256).
  await sweepChatDocumentsAfterMove({
    scope,
    mountPoint: publishedMountPoint(resolvedSource, input.mount_point),
    oldFilePath: input.path,
    newFilePath: input.new_path,
  }, { logFields: { chatId: context.chatId } });

  logger.info('Moved document', {
    from: input.path,
    to: input.new_path,
    scope,
    mountType: resolvedSource.mountType,
  });

  const movedUri = await uriForResolvedPath(resolvedDest);
  await postLibrarianMoveAnnouncement({
    chatId: context.chatId,
    oldDisplayTitle: path.basename(input.path),
    newDisplayTitle: path.basename(input.new_path),
    oldUri: await uriForResolvedPath(resolvedSource),
    newUri: movedUri,
    scope: scope as 'project' | 'document_store' | 'general',
    mountPoint: publishedMountPoint(resolvedSource, input.mount_point),
    origin: await resolveActorOrigin(context),
    isFolder: false,
    hiddenFromCharacters,
  });

  const result: DocMoveFileOutput = {
    success: true,
    old_path: input.path,
    new_path: input.new_path,
    uri: movedUri,
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
  if ((await statDocument(resolvedDest)) === 'folder') {
    // Use posix join so the stored relative path stays forward-slash style,
    // matching the rest of the doc-edit layer.
    const joined = path.posix.join(resolvedDest.relativePath.split(path.sep).join('/'), sourceBasename);
    return joined;
  }

  return resolvedDest.relativePath;
}

export async function handleCopyFile(
  rawInput: DocCopyFileInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocCopyFileOutput; error?: string; formattedText?: string }> {
  // A qtap:// source_uri/dest_uri supersedes the mount_point/path pair. Copy is
  // a document-store-only operation, so reject project/general scopes.
  let sourceMountPoint = rawInput.source_mount_point;
  let sourcePath = rawInput.source_path;
  let destMountPoint = rawInput.dest_mount_point;
  let destPath = rawInput.dest_path;
  if (rawInput.source_uri) {
    const p = parseQtapUri(rawInput.source_uri);
    if (p.scope !== 'document_store') {
      return { success: false, error: 'doc_copy_file addresses document stores only; source_uri must name a store (or "self").' };
    }
    sourceMountPoint = p.mountPoint;
    sourcePath = p.path;
  }
  if (rawInput.dest_uri) {
    const p = parseQtapUri(rawInput.dest_uri);
    if (p.scope !== 'document_store') {
      return { success: false, error: 'doc_copy_file addresses document stores only; dest_uri must name a store (or "self").' };
    }
    destMountPoint = p.mountPoint;
    destPath = p.path;
  }
  if (!sourceMountPoint || typeof sourcePath !== 'string') {
    return { success: false, error: 'Provide source_uri, or both source_mount_point and source_path.' };
  }
  if (!destMountPoint || typeof destPath !== 'string') {
    return { success: false, error: 'Provide dest_uri, or both dest_mount_point and dest_path.' };
  }

  // Text-only guard, to mirror doc_write_file / doc_read_file semantics.
  if (!isTextFile(sourcePath)) {
    return {
      success: false,
      error: `doc_copy_file supports text files only. For binary assets (images, PDFs, etc.), use the blob family of tools.`,
    };
  }

  // Resolve source (read context — peer vaults may be readable in shared chats)
  // and destination (write context — peer vaults are never writable).
  const readContext = await buildReadResolutionContext(
    { mount_point: sourceMountPoint },
    context
  );
  const writeContext = await buildWriteResolutionContext(
    { mount_point: destMountPoint },
    context
  );

  const resolvedSource = await resolveDocEditPath('document_store', sourcePath, readContext);
  // You can't copy what you can't read — gate the source by character_read.
  await assertCharacterMayRead(resolvedSource, context);

  // Initial destination resolve is against the raw dest_path; we re-resolve
  // below once we know whether to append the source basename.
  const destRelInput = destPath ?? '';
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

  const sourceBasename = path.posix.basename(sourcePath.split(path.sep).join('/'));
  const finalDestRel = await resolveCopyDestination(initialResolvedDest, destRelInput, sourceBasename);

  // Re-resolve with the final relative path so downstream existence checks,
  // reindex, and write all see the true destination.
  const resolvedDest = await resolveDocEditPath('document_store', finalDestRel, writeContext);
  // Gate the destination by character_write (no-op when it doesn't exist yet).
  await assertCharacterMayWrite(resolvedDest, context);

  // The source must be a file (an upload counts — readDocument reads it).
  if ((await statDocument(resolvedSource)) === 'folder') {
    return { success: false, error: `Source path is a folder, not a file: ${sourcePath}.` };
  }

  // Refuse to overwrite — match doc_move_file semantics.
  const destination = await statDocument(resolvedDest);
  if (destination === 'folder') {
    return {
      success: false,
      error: `Destination path ${finalDestRel} resolves to a folder, not a file location.`,
    };
  }
  if (destination === 'file') {
    return {
      success: false,
      error: `Destination already exists: ${finalDestRel}. Copy will not overwrite existing files; delete it first if you want to replace it.`,
    };
  }

  let content: string;
  try {
    ({ content } = await readDocument(resolvedSource));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: false, error: `Source file not found: ${sourcePath}` };
    }
    throw error;
  }

  // The core creates parent folders (disk) or folder rows (database), then
  // refreshes the destination store.
  const { mtime } = await writeDocument(resolvedDest, content);

  logger.info('Copied document', {
    source_mount_point: resolvedSource.mountPointName,
    source_path: sourcePath,
    dest_mount_point: resolvedDest.mountPointName,
    dest_path: finalDestRel,
    bytes: content.length,
  });

  const copiedUri = await uriForResolvedPath(resolvedDest);
  await postLibrarianCopyAnnouncement({
    chatId: context.chatId,
    sourceDisplayTitle: sourceBasename,
    destDisplayTitle: path.posix.basename(finalDestRel),
    sourceMountPoint: resolvedSource.mountPointName ?? sourceMountPoint,
    destMountPoint: resolvedDest.mountPointName ?? destMountPoint,
    sourceUri: await uriForResolvedPath(resolvedSource),
    destUri: copiedUri,
    origin: await resolveActorOrigin(context),
    // Gate by the source's read-policy: a character_read:false source must not
    // be named in an announcement to characters (operator path).
    hiddenFromCharacters: await documentHiddenFromCharacters(
      resolvedSource.mountPointId,
      resolvedSource.relativePath,
    ),
  });

  const result: DocCopyFileOutput = {
    success: true,
    source_mount_point: resolvedSource.mountPointName ?? sourceMountPoint,
    source_path: sourcePath,
    dest_mount_point: resolvedDest.mountPointName ?? destMountPoint,
    dest_path: finalDestRel,
    uri: copiedUri,
    mtime,
  };

  return {
    success: true,
    result,
    formattedText: `Copied: ${resolvedSource.mountPointName ?? sourceMountPoint}:${sourcePath} → ${resolvedDest.mountPointName ?? destMountPoint}:${finalDestRel}`,
  };
}

// --- doc_delete_file ---

export async function handleDeleteFile(
  rawInput: DocDeleteFileInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocDeleteFileOutput; error?: string; formattedText?: string }> {
  const input = applyQtapUriToInput(rawInput);
  if (typeof input.path !== 'string') {
    return { success: false, error: 'A `path` or a `uri` is required.' };
  }
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));
  await assertCharacterMayWrite(resolved, context);

  // Capture the read-policy before the delete removes the link row, so a
  // character_read:false document isn't announced to characters (operator path).
  const hiddenFromCharacters = await documentHiddenFromCharacters(
    resolved.mountPointId,
    resolved.relativePath,
  );

  const outcome = await deleteDocument(resolved);
  if (outcome === 'not-found') {
    return { success: false, error: `File not found: ${input.path}` };
  }
  if (outcome === 'not-a-file') {
    return { success: false, error: `Path is a folder, not a file: ${input.path}. Use doc_delete_folder to remove folders.` };
  }

  logger.info('Deleted document', { path: input.path, scope, mountType: resolved.mountType });

  await postLibrarianDeleteAnnouncement({
    chatId: context.chatId,
    displayTitle: path.basename(input.path),
    filePath: input.path,
    scope: scope as 'project' | 'document_store' | 'general',
    mountPoint: publishedMountPoint(resolved, input.mount_point),
    origin: await resolveActorOrigin(context),
    hiddenFromCharacters,
  });

  const result: DocDeleteFileOutput = {
    success: true,
    path: input.path,
    uri: await uriForResolvedPath(resolved),
  };

  return {
    success: true,
    result,
    formattedText: `Deleted file: ${input.path}`,
  };
}

// --- doc_create_folder ---

export async function handleCreateFolder(
  rawInput: DocCreateFolderInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocCreateFolderOutput; error?: string; formattedText?: string }> {
  const input = applyQtapUriToInput(rawInput);
  if (typeof input.path !== 'string') {
    return { success: false, error: 'A `path` or a `uri` is required.' };
  }
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
        mountPoint: publishedMountPoint(resolved, input.mount_point),
        origin: await resolveActorOrigin(context),
      });
      return {
        success: true,
        result: { success: true, path: input.path, uri: await uriForResolvedPath(resolved) },
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
    mountPoint: publishedMountPoint(resolved, input.mount_point),
    origin: await resolveActorOrigin(context),
  });

  const result: DocCreateFolderOutput = {
    success: true,
    path: input.path,
    uri: await uriForResolvedPath(resolved),
  };

  return {
    success: true,
    result,
    formattedText: `Created folder: ${input.path}`,
  };
}

// --- doc_delete_folder ---

export async function handleDeleteFolder(
  rawInput: DocDeleteFolderInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocDeleteFolderOutput; error?: string; formattedText?: string }> {
  const input = applyQtapUriToInput(rawInput);
  if (typeof input.path !== 'string') {
    return { success: false, error: 'A `path` or a `uri` is required.' };
  }
  const scope = (input.scope || 'document_store') as DocEditScope;
  const resolved = await resolveDocEditPath(scope, input.path, await buildWriteResolutionContext(input, context));
  // A character may not delete a folder that holds a protected document.
  await assertFolderHasNoWriteProtectedDescendants(resolved, context);

  // Database-backed mount: delete explicit folder rows
  if (resolved.mountType === 'database' && resolved.mountPointId) {
    try {
      await deleteDatabaseFolder(resolved.mountPointId, resolved.relativePath);
      logger.info('Deleted database folder', { path: input.path, scope });
      await postLibrarianFolderDeletedAnnouncement({
        chatId: context.chatId,
        folderPath: input.path,
        scope: scope as 'project' | 'document_store' | 'general',
        mountPoint: publishedMountPoint(resolved, input.mount_point),
        origin: await resolveActorOrigin(context),
      });
      return {
        success: true,
        result: { success: true, path: input.path, uri: await uriForResolvedPath(resolved) },
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
    mountPoint: publishedMountPoint(resolved, input.mount_point),
    origin: await resolveActorOrigin(context),
  });

  const result: DocDeleteFolderOutput = {
    success: true,
    path: input.path,
    uri: await uriForResolvedPath(resolved),
  };

  return {
    success: true,
    result,
    formattedText: `Deleted folder: ${input.path}`,
  };
}

// --- doc_move_folder ---

export async function handleMoveFolder(
  rawInput: DocMoveFolderInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocMoveFolderOutput; error?: string; formattedText?: string }> {
  const input = applyQtapUriToInput(rawInput);
  if (typeof input.path !== 'string') {
    return { success: false, error: 'A `path` (or `uri`) for the source folder is required.' };
  }
  const scope = (input.scope || 'document_store') as DocEditScope;

  // Resolve source path
  const writeContext = await buildWriteResolutionContext(input, context);
  const resolvedSource = await resolveDocEditPath(scope, input.path, writeContext);
  const resolvedDest = await resolveDocEditPath(scope, input.new_path, writeContext);

  // Moving a folder relocates everything under it — a character may not move a
  // folder that holds a protected document.
  await assertFolderHasNoWriteProtectedDescendants(resolvedSource, context);

  // Database-backed mount: route move through the database-store module
  if (resolvedSource.mountType === 'database' && resolvedSource.mountPointId) {
    try {
      await moveDatabaseFolder(
        resolvedSource.mountPointId,
        resolvedSource.relativePath,
        resolvedDest.relativePath
      );
      await syncChatDocumentsAfterFolderMove(scope, input.mount_point, input.path, input.new_path);
      logger.info('Moved database folder', {
        from: input.path,
        to: input.new_path,
        scope,
      });
      const movedFolderUri = await uriForResolvedPath(resolvedDest);
      await postLibrarianMoveAnnouncement({
        chatId: context.chatId,
        oldDisplayTitle: path.basename(input.path),
        newDisplayTitle: path.basename(input.new_path),
        oldUri: await uriForResolvedPath(resolvedSource),
        newUri: movedFolderUri,
        scope: scope as 'project' | 'document_store' | 'general',
        mountPoint: publishedMountPoint(resolvedSource, input.mount_point),
        origin: await resolveActorOrigin(context),
        isFolder: true,
      });
      return {
        success: true,
        result: { success: true, old_path: input.path, new_path: input.new_path, uri: movedFolderUri },
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

  // Check destination doesn't already exist. Skip for a case-only rename —
  // on a case-insensitive filesystem the probe would find the source itself.
  const folderCaseOnlyRename =
    resolvedSource.absolutePath !== resolvedDest.absolutePath &&
    resolvedSource.absolutePath.toLowerCase() === resolvedDest.absolutePath.toLowerCase();
  if (!folderCaseOnlyRename) {
    try {
      await fs.access(resolvedDest.absolutePath);
      return { success: false, error: `Destination already exists: ${input.new_path}. Move will not overwrite existing folders.` };
    } catch {
      // Good — destination doesn't exist
    }
  }

  // Ensure parent directory of destination exists
  const destParent = path.dirname(resolvedDest.absolutePath);
  await fs.mkdir(destParent, { recursive: true });

  // Perform the move
  await fs.rename(resolvedSource.absolutePath, resolvedDest.absolutePath);

  await syncChatDocumentsAfterFolderMove(scope, input.mount_point, input.path, input.new_path);

  logger.info('Moved folder', {
    from: input.path,
    to: input.new_path,
    scope,
  });

  const movedFolderUri = await uriForResolvedPath(resolvedDest);
  await postLibrarianMoveAnnouncement({
    chatId: context.chatId,
    oldDisplayTitle: path.basename(input.path),
    newDisplayTitle: path.basename(input.new_path),
    oldUri: await uriForResolvedPath(resolvedSource),
    newUri: movedFolderUri,
    scope: scope as 'project' | 'document_store' | 'general',
    mountPoint: publishedMountPoint(resolvedSource, input.mount_point),
    origin: await resolveActorOrigin(context),
    isFolder: true,
  });

  const result: DocMoveFolderOutput = {
    success: true,
    old_path: input.path,
    new_path: input.new_path,
    uri: movedFolderUri,
  };

  return {
    success: true,
    result,
    formattedText: `Moved folder: ${input.path} → ${input.new_path}`,
  };
}
