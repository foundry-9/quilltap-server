/**
 * Commonplace Digest Vault Bridge
 *
 * Mirrors a character's hot memory digests into their own vault after a
 * consolidation run (memory-consolidation-and-tiers.md §C6): one file per
 * subject bucket, `Commonplace/<Subject Name>.md` and `Commonplace/Self.md`,
 * rewritten whole each time. The folder is separate from the hand-written
 * `Others/` folder, so no user prose is ever touched. The extractor reads the
 * files back as canon (`cheap-llm-tasks/canon.ts`).
 *
 * Like the conversation-summary bridge, the write short-circuits to the parent
 * via host-RPC when running in the forked job child (`QUILLTAP_JOB_CHILD ===
 * '1'`): `writeDatabaseDocument` issues real `doc_mount_*` writes whose
 * server-computed ids the child's buffered-write proxy can't model.
 *
 * Archived characters are tombstones: their vault stays live and writable, so
 * this bridge checks `findByIdRaw(...).archivedAt` and skips them — it never
 * resolves or creates a vault for an archived character.
 *
 * @module file-storage/commonplace-digest-vault-bridge
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getCharacterVaultStore } from './character-vault-bridge';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import {
  readDatabaseDocumentIfExists,
  writeDatabaseDocument,
} from '@/lib/mount-index/database-store';
import {
  COMMONPLACE_FOLDER,
  commonplacePathFor,
  renderCommonplaceFile,
  type CommonplaceDigestEntry,
} from '@/lib/memory/commonplace-file';

/** One subject bucket's mirror. */
export interface CommonplaceMirrorFile {
  /** The subject's character id; the holder's own id when `isSelf`. */
  subjectCharacterId: string;
  subjectName: string;
  isSelf: boolean;
  /** Every hot digest in the bucket after the run (the bridge orders and trims). */
  digests: CommonplaceDigestEntry[];
}

export interface WriteCommonplaceDigestsInput {
  holderCharacterId: string;
  files: CommonplaceMirrorFile[];
  /** ISO timestamp stamped into each file's frontmatter. */
  updatedAt: string;
}

export interface WriteCommonplaceDigestsResult {
  written: number;
  unchanged: number;
  skipped: number;
  /** Why the whole mirror was skipped, when it was. */
  skippedReason?: 'archived' | 'missing-character' | 'no-vault';
}

/**
 * Write (or rewrite) the holder's Commonplace mirror files. Best-effort per
 * file; never throws to the caller — the digests themselves are the record,
 * the mirror is a convenience the next run rewrites anyway.
 */
export async function writeCommonplaceDigestsToVault(
  input: WriteCommonplaceDigestsInput
): Promise<WriteCommonplaceDigestsResult> {
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client');
    return callHost<WriteCommonplaceDigestsResult>('writeCommonplaceDigestsToVault', input);
  }

  const result: WriteCommonplaceDigestsResult = { written: 0, unchanged: 0, skipped: 0 };
  const context = 'file-storage.commonplace-digest-vault-bridge';

  try {
    // Tombstone guard, on the raw row: the overlay read is for live characters.
    const raw = await getRepositories().characters.findByIdRaw(input.holderCharacterId);
    if (!raw) {
      logger.debug('Skipping Commonplace mirror: holder not found', {
        context,
        characterId: input.holderCharacterId,
      });
      return { ...result, skipped: input.files.length, skippedReason: 'missing-character' };
    }
    if (raw.archivedAt) {
      logger.debug('Skipping Commonplace mirror for archived character', {
        context,
        characterId: input.holderCharacterId,
      });
      return { ...result, skipped: input.files.length, skippedReason: 'archived' };
    }

    const target = await getCharacterVaultStore(input.holderCharacterId);
    if (!target) {
      logger.debug('Skipping Commonplace mirror: holder has no character vault', {
        context,
        characterId: input.holderCharacterId,
      });
      return { ...result, skipped: input.files.length, skippedReason: 'no-vault' };
    }

    const toWrite = input.files.filter((f) => f.digests.length > 0);
    if (toWrite.length > 0) {
      await ensureFolderPath(target.mountPointId, COMMONPLACE_FOLDER);
    }
    result.skipped += input.files.length - toWrite.length;

    for (const file of toWrite) {
      const path = commonplacePathFor(
        file.isSelf ? 'self' : { id: file.subjectCharacterId, name: file.subjectName }
      );
      try {
        const rendered = renderCommonplaceFile({
          subjectCharacterId: file.subjectCharacterId,
          subjectName: file.subjectName,
          isSelf: file.isSelf,
          digests: file.digests,
          updatedAt: input.updatedAt,
        });
        const existing = await readDatabaseDocumentIfExists(target.mountPointId, path);
        if (existing !== null && stripUpdatedAt(existing) === stripUpdatedAt(rendered.content)) {
          result.unchanged++;
          continue;
        }
        await writeDatabaseDocument(target.mountPointId, path, rendered.content);
        result.written++;
        logger.debug('Wrote Commonplace digest mirror', {
          context,
          characterId: input.holderCharacterId,
          path,
          entriesWritten: rendered.entriesWritten,
          entriesDropped: rendered.entriesDropped,
        });
      } catch (error) {
        result.skipped++;
        logger.warn('Failed to write a Commonplace digest mirror', {
          context,
          characterId: input.holderCharacterId,
          path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.warn('Commonplace mirror failed', {
      context,
      characterId: input.holderCharacterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.debug('Commonplace mirror complete', {
    context,
    characterId: input.holderCharacterId,
    ...result,
  });
  return result;
}

/**
 * Compare files ignoring the `updatedAt` stamp, so a bucket whose digests did
 * not change is not rewritten (and its vault document not re-embedded) merely
 * because the clock moved.
 */
function stripUpdatedAt(content: string): string {
  return content.replace(/^updatedAt: .*$/m, '');
}
