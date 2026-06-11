/**
 * Translate a failed mount-point op into a user-facing verdict (pure).
 *
 * The adapter fires REST calls and gets back an HTTP status + (for file-op
 * failures) a `code` in the JSON body — the union of `FileOpError` codes and
 * the database-store codes the route surfaces. This maps either to a
 * steampunk-voiced message (UI strings follow the project writing style), a
 * `rollback` flag (every failure rolls back SVAR's optimistic move/rename/etc.),
 * and `suggestCopy` for the headline case: a hard-link/move that the backend
 * refuses across storage types, where the right offer is "copy instead."
 *
 * @module components/files/svar/error-translation
 */

/** Codes the v1 routes emit (FileOpError ∪ DatabaseStoreError). */
export type MountOpErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'DEST_EXISTS'
  | 'MOUNT_NOT_FOUND'
  | 'INVALID_PATH'
  | 'UNSUPPORTED'
  | 'VERIFY_FAILED'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'INVALID'
  | 'NOT_EMPTY'

export interface ErrorVerdict {
  message: string
  /** Revert the optimistic SVAR tree change that triggered this call. */
  rollback: boolean
  /** Offer "copy instead" — set for the cross-storage link/move refusal. */
  suggestCopy: boolean
  /** The change-on-disk conflict — prompt the user before overwriting. */
  conflict: boolean
}

const BY_CODE: Record<MountOpErrorCode, Omit<ErrorVerdict, 'rollback'>> = {
  UNSUPPORTED: {
    message: 'These two repositories keep their ledgers differently, so a direct link won’t hold. Shall I copy it across instead?',
    suggestCopy: true,
    conflict: false,
  },
  DEST_EXISTS: {
    message: 'A document already keeps that desk. Choose another name, or overwrite the incumbent.',
    suggestCopy: false,
    conflict: true,
  },
  CONFLICT: {
    message: 'That file has changed on disk since you opened it. Reload before saving, lest you overwrite a newer hand.',
    suggestCopy: false,
    conflict: true,
  },
  NOT_EMPTY: {
    message: 'That drawer isn’t empty — clear its contents before discarding the folder.',
    suggestCopy: false,
    conflict: false,
  },
  SOURCE_NOT_FOUND: {
    message: 'I can’t lay hands on that item any longer — it may have been moved or removed. Refreshing the shelves.',
    suggestCopy: false,
    conflict: false,
  },
  NOT_FOUND: {
    message: 'I can’t lay hands on that item any longer — it may have been moved or removed. Refreshing the shelves.',
    suggestCopy: false,
    conflict: false,
  },
  MOUNT_NOT_FOUND: {
    message: 'That repository has gone missing from the catalogue. Refreshing the shelves.',
    suggestCopy: false,
    conflict: false,
  },
  INVALID_PATH: {
    message: 'That name won’t do — kindly avoid slashes and other untoward marks.',
    suggestCopy: false,
    conflict: false,
  },
  INVALID: {
    message: 'That request didn’t sit right with the archive. Do try again.',
    suggestCopy: false,
    conflict: false,
  },
  VERIFY_FAILED: {
    message: 'Something went awry mid-transit and the archive couldn’t vouch for the result. Nothing was changed.',
    suggestCopy: false,
    conflict: false,
  },
}

const FALLBACK: Omit<ErrorVerdict, 'rollback'> = {
  message: 'The archive declined that request for reasons it didn’t care to share. Do try again.',
  suggestCopy: false,
  conflict: false,
}

/**
 * Map an error response to a verdict. Prefer the body `code`; fall back to HTTP
 * status for responses without one. Every recognized failure rolls back the
 * optimistic SVAR change.
 */
export function translateMountOpError(input: { status?: number; code?: string }): ErrorVerdict {
  const byCode = input.code && (BY_CODE as Record<string, Omit<ErrorVerdict, 'rollback'>>)[input.code]
  if (byCode) return { ...byCode, rollback: true }

  // No recognized code — infer the gist from the HTTP status.
  if (input.status === 409) return { ...BY_CODE.CONFLICT, rollback: true }
  if (input.status === 404) return { ...BY_CODE.NOT_FOUND, rollback: true }
  if (input.status === 400) return { ...BY_CODE.INVALID, rollback: true }
  return { ...FALLBACK, rollback: true }
}
