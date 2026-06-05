/**
 * Shared context, logging, and cross-cutting helpers for the doc-edit tool
 * handlers.
 *
 * These helpers are used across multiple handler groups (text, markdown, file
 * management, document UI, blob). Group-local helpers live alongside their
 * handlers instead of here.
 *
 * @module tools/handlers/doc-edit/shared
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import {
  reindexSingleFile,
  PathResolutionError,
  type ResolvedPath,
} from '@/lib/doc-edit';
import { getRepositories } from '@/lib/repositories/factory';
import { isParticipantPresent } from '@/lib/schemas/chat.types';
import { enqueueEmbeddingJobsForMountPoint } from '@/lib/mount-index/embedding-scheduler';

export const logger = createServiceLogger('DocEdit:Handler');

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
 * Collect the character IDs of other present participants in the chat whose
 * vaults should be readable — only when the chat has the
 * `allowCrossCharacterVaultReads` flag enabled. Returns an empty array when
 * the flag is off, the chat isn't found, or the acting character is the only
 * present participant.
 */
export async function collectPeerCharacterIdsForReads(
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
export async function actingCharacterIsOpaqueToVaults(
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
export async function assertWriteDoesNotTargetPeerVault(
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
export async function buildReadResolutionContext(
  input: { scope?: string; mount_point?: string },
  context: DocEditToolContext
) {
  const opaque = await actingCharacterIsOpaqueToVaults(context);
  if (opaque) {
    // No characterId / characterIds → resolver admits only project document
    // stores. Mount-point name lookups for character vaults won't resolve.
    return {
      projectId: context.projectId,
      mountPoint: input.mount_point,
    };
  }
  const peerCharacterIds = await collectPeerCharacterIdsForReads(context);
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
export async function buildWriteResolutionContext(
  input: { scope?: string; mount_point?: string },
  context: DocEditToolContext
) {
  const opaque = await actingCharacterIsOpaqueToVaults(context);
  if (opaque) {
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
 * Look up the project's "project-official" mount point — the canonical
 * `scope: 'project'` store. Returns null when the project has no
 * officialMountPointId, the mount is missing, or it's disabled. Callers can
 * then fall back to the legacy `<filesDir>/<projectId>/` walk for projects
 * that haven't been migrated yet.
 */
export interface OfficialProjectMount {
  id: string;
  name: string;
  basePath: string;
  mountType: 'filesystem' | 'obsidian' | 'database';
}

export async function resolveOfficialProjectMount(
  projectId: string | undefined
): Promise<OfficialProjectMount | null> {
  if (!projectId) return null;
  try {
    const repos = getRepositories();
    const project = await repos.projects.findById(projectId);
    if (!project?.officialMountPointId) return null;
    const mp = await repos.docMountPoints.findById(project.officialMountPointId);
    if (!mp || !mp.enabled) return null;
    return {
      id: mp.id,
      name: mp.name,
      basePath: mp.basePath,
      mountType: mp.mountType,
    };
  } catch (err) {
    logger.warn('Failed to resolve official project mount; treating project as un-migrated', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Trigger re-indexing and embedding for any write that lands in a mount
 * point. The gate is `mountPointId`, not `scope`: a `scope: 'project'`
 * write into a project's `officialMountPointId` mount needs the same
 * chunk/embed pass as a `scope: 'document_store'` write, otherwise the
 * file is invisible to search until the next periodic mount scan. Legacy
 * filesystem-only projects (no `officialMountPointId`) return without a
 * `mountPointId` and silently no-op here, as before.
 */
export async function triggerReindexIfNeeded(resolved: ResolvedPath): Promise<void> {
  if (resolved.mountPointId) {
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
