/**
 * Blob tool handlers: doc_write_blob, doc_read_blob, doc_list_blobs,
 * doc_delete_blob.
 *
 * @module tools/handlers/doc-edit/blob-handlers
 */

import { getAccessibleMountPoints, resolveMountPointRef } from '@/lib/doc-edit';
import { transcodeToWebP, normaliseBlobRelativePath } from '@/lib/mount-index/blob-transcode';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocWriteBlobInput, DocWriteBlobOutput } from '../../doc-write-blob-tool';
import type { DocReadBlobInput, DocReadBlobOutput } from '../../doc-read-blob-tool';
import type { DocListBlobsInput, DocListBlobsOutput } from '../../doc-list-blobs-tool';
import type { DocDeleteBlobInput, DocDeleteBlobOutput } from '../../doc-delete-blob-tool';
import {
  logger,
  type DocEditToolContext,
  collectPeerCharacterIdsForReads,
  assertWriteDoesNotTargetPeerVault,
} from './shared';

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

export async function handleReadBlob(
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

export async function handleListBlobs(
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

export async function handleDeleteBlob(
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
