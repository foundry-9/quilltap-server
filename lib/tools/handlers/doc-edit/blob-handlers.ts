/**
 * Blob tool handlers: doc_write_blob, doc_read_blob, doc_list_blobs,
 * doc_delete_blob.
 *
 * @module tools/handlers/doc-edit/blob-handlers
 */

import path from 'path';
import { getAccessibleMountPoints, resolveMountPointRef, parseQtapUri } from '@/lib/doc-edit';
import { transcodeToWebP, normaliseBlobRelativePath } from '@/lib/mount-index/blob-transcode';
import { getRepositories } from '@/lib/repositories/factory';
import {
  postLibrarianBlobWriteAnnouncement,
  postLibrarianDeleteAnnouncement,
} from '@/lib/services/librarian-notifications/writer';
import type { DocWriteBlobInput, DocWriteBlobOutput } from '../../doc-write-blob-tool';
import type { DocReadBlobInput, DocReadBlobOutput } from '../../doc-read-blob-tool';
import type { DocListBlobsInput, DocListBlobsOutput } from '../../doc-list-blobs-tool';
import type { DocDeleteBlobInput, DocDeleteBlobOutput } from '../../doc-delete-blob-tool';
import {
  logger,
  type DocEditToolContext,
  collectPeerCharacterIdsForReads,
  assertWriteDoesNotTargetPeerVault,
  docStoreUriFor,
  buildDocStoreUriResolver,
  resolveActorOrigin,
} from './shared';

/**
 * Project a blob tool's optional `uri` onto a `{ mountPoint, path }` pair.
 * Blobs live only in document stores, so a non-`document_store` scope is
 * rejected. When no `uri` is given, the explicit mount_point/path pass through.
 * Throws a clear `Error` (surfaced as a tool error) on a project/general URI.
 */
function resolveBlobTarget(input: { uri?: string; mount_point?: string; path?: string }): {
  mountPoint?: string;
  path?: string;
} {
  if (input.uri) {
    const parts = parseQtapUri(input.uri);
    if (parts.scope !== 'document_store') {
      throw new Error('Blobs live only in document stores; the qtap:// URI must name a store (or "self").');
    }
    return { mountPoint: parts.mountPoint, path: parts.path };
  }
  return { mountPoint: input.mount_point, path: input.path };
}

async function resolveBlobMountPointForRead(
  mountPointRef: string,
  context: DocEditToolContext
): Promise<{ id: string; name: string } | null> {
  if (!context.projectId && !context.characterId) return null;
  // Translate the reserved self-token to the acting character's own vault ID so
  // `mount_point: "self"` resolves here too, mirroring the path resolver.
  const effectiveRef = await resolveMountPointRef(mountPointRef, context.characterId);
  const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
  const mountPoints = await getAccessibleMountPoints(context.projectId, context.characterId, peerCharacterIds);
  const needle = effectiveRef.toLowerCase();
  const found = mountPoints.find(
    mp => mp.name.toLowerCase() === needle || mp.id === effectiveRef
  );
  return found ? { id: found.id, name: found.name } : null;
}

async function resolveBlobMountPointForWrite(
  mountPointRef: string,
  context: DocEditToolContext
): Promise<{ id: string; name: string } | null> {
  if (!context.projectId && !context.characterId) return null;
  // Translate the reserved self-token before matching. "self" is always the
  // acting character's own vault, never a peer's, so the peer-vault guard below
  // can run against the original reference unchanged.
  const effectiveRef = await resolveMountPointRef(mountPointRef, context.characterId);
  const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
  // Writes must not land in a peer's vault — raise the dedicated read-only error
  // before we even enumerate accessible mounts.
  await assertWriteDoesNotTargetPeerVault(mountPointRef, peerCharacterIds);
  const mountPoints = await getAccessibleMountPoints(context.projectId, context.characterId);
  const needle = effectiveRef.toLowerCase();
  const found = mountPoints.find(
    mp => mp.name.toLowerCase() === needle || mp.id === effectiveRef
  );
  return found ? { id: found.id, name: found.name } : null;
}

export async function handleWriteBlob(
  input: DocWriteBlobInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocWriteBlobOutput; error?: string; formattedText?: string }> {
  let target: { mountPoint?: string; path?: string };
  try {
    target = resolveBlobTarget(input);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!target.mountPoint || typeof target.path !== 'string') {
    return { success: false, error: 'A `mount_point` + `path` (or a `uri`) is required.' };
  }
  const mp = await resolveBlobMountPointForWrite(target.mountPoint, context);
  if (!mp) {
    return { success: false, error: `Mount point not found or not linked to this project: ${target.mountPoint}` };
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
  const finalPath = normaliseBlobRelativePath(target.path, transcoded.storedMimeType);

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

  const storedUri = await docStoreUriFor({ mountPointId: mp.id, mountPointName: mp.name, relativePath: stored.relativePath, characterId: context.characterId });

  await postLibrarianBlobWriteAnnouncement({
    chatId: context.chatId,
    displayTitle: path.basename(stored.relativePath),
    uri: storedUri,
    mountPoint: mp.name,
    mimeType: stored.storedMimeType,
    sizeBytes: stored.sizeBytes,
    description: input.description,
    origin: await resolveActorOrigin(context),
  });

  const result: DocWriteBlobOutput = {
    success: true,
    mount_point: mp.name,
    relative_path: stored.relativePath,
    uri: storedUri,
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

export async function handleReadBlob(
  input: DocReadBlobInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocReadBlobOutput; error?: string; formattedText?: string }> {
  let target: { mountPoint?: string; path?: string };
  try {
    target = resolveBlobTarget(input);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!target.mountPoint || typeof target.path !== 'string') {
    return { success: false, error: 'A `mount_point` + `path` (or a `uri`) is required.' };
  }
  const mp = await resolveBlobMountPointForRead(target.mountPoint, context);
  if (!mp) {
    return { success: false, error: `Mount point not found or not linked to this project: ${target.mountPoint}` };
  }
  const repos = getRepositories();
  const meta = await repos.docMountBlobs.findByMountPointAndPath(mp.id, target.path);
  if (!meta) {
    return { success: false, error: `Blob not found: ${target.path}` };
  }

  const result: DocReadBlobOutput = {
    mount_point: mp.name,
    relative_path: meta.relativePath,
    uri: await docStoreUriFor({ mountPointId: mp.id, mountPointName: mp.name, relativePath: meta.relativePath, characterId: context.characterId }),
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

export async function handleListBlobs(
  input: DocListBlobsInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocListBlobsOutput; error?: string; formattedText?: string }> {
  // A qtap:// URI may address a store root or a folder; its path becomes the
  // folder filter here.
  let mountPointRef = input.mount_point;
  let folder = input.folder;
  if (input.uri) {
    let parts;
    try {
      parts = resolveBlobTarget({ uri: input.uri });
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    mountPointRef = parts.mountPoint;
    folder = parts.path ? parts.path : input.folder;
  }
  if (!mountPointRef) {
    return { success: false, error: 'A `mount_point` or a `uri` is required.' };
  }
  const mp = await resolveBlobMountPointForRead(mountPointRef, context);
  if (!mp) {
    return { success: false, error: `Mount point not found or not linked to this project: ${mountPointRef}` };
  }
  const repos = getRepositories();
  const metas = await repos.docMountBlobs.listByMountPoint(
    mp.id,
    folder ? { folder } : {}
  );
  const uriResolver = await buildDocStoreUriResolver(context.characterId);
  const result: DocListBlobsOutput = {
    mount_point: mp.name,
    blobs: metas.map(m => ({
      relative_path: m.relativePath,
      uri: uriResolver.uriForMount(mp.name, mp.id, m.relativePath),
      original_filename: m.originalFileName,
      original_mime_type: m.originalMimeType,
      stored_mime_type: m.storedMimeType,
      size_bytes: m.sizeBytes,
      description: m.description,
    })),
    total: metas.length,
  };
  const formatted = metas.length === 0
    ? `No blobs in [${mp.name}]${folder ? ` under ${folder}` : ''}.`
    : `${metas.length} blobs in [${mp.name}]:\n` +
      metas.map(m => `  ${m.relativePath}  (${m.storedMimeType}, ${m.sizeBytes} bytes)${m.description ? `  — ${m.description}` : ''}`).join('\n');
  return { success: true, result, formattedText: formatted };
}

export async function handleDeleteBlob(
  input: DocDeleteBlobInput,
  context: DocEditToolContext
): Promise<{ success: boolean; result?: DocDeleteBlobOutput; error?: string; formattedText?: string }> {
  let target: { mountPoint?: string; path?: string };
  try {
    target = resolveBlobTarget(input);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!target.mountPoint || typeof target.path !== 'string') {
    return { success: false, error: 'A `mount_point` + `path` (or a `uri`) is required.' };
  }
  const mp = await resolveBlobMountPointForWrite(target.mountPoint, context);
  if (!mp) {
    return { success: false, error: `Mount point not found or not linked to this project: ${target.mountPoint}` };
  }
  const repos = getRepositories();
  const deleted = await repos.docMountBlobs.deleteByMountPointAndPath(mp.id, target.path);
  if (!deleted) {
    return { success: false, error: `Blob not found: ${target.path}` };
  }
  logger.info('Deleted blob', { mountPointId: mp.id, relativePath: target.path });
  const deletedUri = await docStoreUriFor({ mountPointId: mp.id, mountPointName: mp.name, relativePath: target.path, characterId: context.characterId });
  await postLibrarianDeleteAnnouncement({
    chatId: context.chatId,
    displayTitle: path.basename(target.path),
    filePath: target.path,
    scope: 'document_store',
    mountPoint: mp.name,
    origin: await resolveActorOrigin(context),
  });
  const result: DocDeleteBlobOutput = {
    success: true,
    mount_point: mp.name,
    relative_path: target.path,
    uri: deletedUri,
  };
  return { success: true, result, formattedText: `Deleted blob [${mp.name}] ${target.path}` };
}
