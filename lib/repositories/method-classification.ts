/**
 * Repository method classification — read or write, by name.
 *
 * One rulebook for every wrapper that must tell a read from a write without
 * running the method: the job child's buffering proxy
 * (`lib/background-jobs/child/child-repositories-proxy.ts`) and the parent's
 * dry scope (`lib/repositories/dry-scope.ts`). A method is classified by its
 * prefix, unless {@link METHOD_OVERRIDES} names it.
 *
 * @module repositories/method-classification
 */

import crypto from 'crypto';

export type RepositoryMethodKind = 'read' | 'write' | 'unknown';

export const READ_PREFIXES = ['find', 'get', 'list', 'count', 'search', 'has', 'exists', 'is', 'fetch', 'query', 'load', 'read'];
export const WRITE_PREFIXES = ['create', 'update', 'delete', 'upsert', 'bulk', 'set', 'mark', 'reset', 'cleanup', 'clear', 'increment', 'decrement', 'add', 'remove', 'cancel', 'touch', 'save'];

/**
 * Explicit overrides for methods whose names don't match the prefixes above.
 * Format: `'<repoKey>.<methodName>': 'read' | 'write'`.
 */
export const METHOD_OVERRIDES: Record<string, 'read' | 'write'> = {
  // ---- Reads with non-conforming names -------------------------------------
  'chats.getMessages': 'read',
  'chats.getEquippedOutfitForCharacter': 'read',
  'folders.findByPath': 'read',
  'conversationChunks.findByInterchangeIndex': 'read',
  'backgroundJobs.findByUserId': 'read',
  'backgroundJobs.findDistinctChatIds': 'read',

  // ---- Writes with non-conforming names ------------------------------------
  // folders: find-or-create. Buffered *whole* so the parent replays it on its
  // RW connection, where read-your-writes and the (userId, projectId, path)
  // unique index make it genuinely idempotent — a child-side read could not see
  // another job's buffered create, which is how the legacy `folders` table
  // grew a row per generated image (bug 114). Its in-child callers (the
  // story-background and character-avatar handlers) DISCARD the return value,
  // so the `undefined` synthetic write result is fine; a caller that needs the
  // folder back must not run in the child.
  'folders.ensureByPath': 'write',
  // memories
  'memories.updateForCharacter': 'write',
  // Footnote delta applied against the live row at commit (bug 231).
  'memories.appendReinforcementFootnotes': 'write',
  // chats
  'chats.updateMessage': 'write',
  // The transcript counter's bump and its realtime hint. A write, so the parent
  // replays it on its RW connection; the child's own publish would be a no-op
  // anyway. Callers discard the return.
  'chats.announceTranscriptChange': 'write',
  // Wardrobe wear ledger. `commitEquippedOutfit` is the equip chokepoint: it
  // writes a character's slots and credits the wears the write represents,
  // diffing against the prior slots. Buffered whole so the parent replays it
  // on its RW connection, where the prior state is true — the child's
  // snapshot is stale within a job and blind to its own earlier writes, so a
  // child-side diff would double-count. Callers discard the return. The slots
  // it carries feed the job's equipped-outfit overlay, so a later
  // `chats.getEquippedOutfitForCharacter` in the same job sees them (bug 179).
  'wardrobeWear.commitEquippedOutfit': 'write',
  // Character-delete cleanup: folds rows into the unattributed row. Not
  // reached from a job today; classified so it can never be mistaken for a read.
  'wardrobeWear.foldWearerIntoUnattributed': 'write',
  // Outfit history. `settle` is the one runtime writer of
  // `chat_wardrobe_history`: it reads the chat's live slots and appends an
  // entry or moves the cursor. Buffered whole so the parent replays it on its
  // RW connection *after* the turn's `commitEquippedOutfit` (buffered writes
  // replay in order within the main partition), so its read of the live slots
  // sees the turn's final state, never the child's stale snapshot. Callers
  // discard the return. `findEntries` / `findCurrent` stay reads and answer
  // from the job's snapshot.
  'wardrobeHistory.settle': 'write',
  // background jobs
  'backgroundJobs.cancelByType': 'write',
  'backgroundJobs.createBatch': 'write',
  // embedding status
  'embeddingStatus.markAsEmbedded': 'write',
  'embeddingStatus.markAsFailed': 'write',
  'embeddingStatus.markAllPendingByProfileId': 'write',
  // tfidf vocabularies
  'tfidfVocabularies.upsertByProfileId': 'write',
  // help docs
  'helpDocs.clearAllEmbeddings': 'write',
  // `replaceForDoc` is buffered whole and replayed by the parent, so its
  // internal creates never run in the child. Its return (a row count) is the
  // synthetic `undefined` — no caller may consume it. `deleteByDocId` and
  // `deleteOrphaned` classify as writes from their prefix already.
  'helpDocChunks.replaceForDoc': 'write',
  // llm logs
  'llmLogs.cleanupOldLogs': 'write',
  // conversation chunks
  'conversationChunks.upsert': 'write',
  // doc mount points
  'docMountPoints.refreshStats': 'write',
  // doc-mount file-link content writers (database-backed stores). These
  // INSERT/UPDATE doc_mount_files / doc_mount_documents|blobs / doc_mount_file_links
  // via getRawMountIndexDatabase(), so they can only work in the child by being
  // buffered (the child DB is readonly; the parent applies them on its RW
  // connection). Their in-child callers — database-store.writeDatabaseDocument
  // and file-ops.writeDestBytes, reached by doc_write_file / doc_copy_file during
  // AUTONOMOUS_ROOM_TURN — DISCARD the return value, so the `undefined` synthetic
  // write result (syntheticWriteResult only shapes create*/upsert*) is fine. A
  // caller that consumes the return must NOT run in the child; see
  // CHILD_UNSUPPORTED_METHODS for why linkFilesystemFile is deliberately excluded.
  'docMountFileLinks.linkDocumentContent': 'write',
  'docMountFileLinks.linkBlobContent': 'write',
};

/**
 * Classify `<repoKey>.<methodName>` by override, then lifecycle names, then
 * prefix. 'unknown' means no rule matched.
 */
export function classifyRepositoryMethod(repoKey: string, methodName: string): RepositoryMethodKind {
  const fqn = `${repoKey}.${methodName}`;
  if (METHOD_OVERRIDES[fqn]) return METHOD_OVERRIDES[fqn];

  // Lifecycle / introspection methods on every repo — pass through as reads.
  if (methodName === 'constructor' || methodName.startsWith('_')) return 'read';
  if (methodName === 'then' || methodName === 'toJSON' || methodName === 'toString' || methodName === 'inspect') return 'read';

  for (const p of READ_PREFIXES) {
    if (methodName.startsWith(p) && (methodName.length === p.length || /[A-Z]/.test(methodName[p.length]))) {
      return 'read';
    }
  }
  for (const p of WRITE_PREFIXES) {
    if (methodName.startsWith(p) && (methodName.length === p.length || /[A-Z]/.test(methodName[p.length]))) {
      return 'write';
    }
  }
  return 'unknown';
}

// ============================================================================
// Synthetic result builder
// ============================================================================

/**
 * Produce a placeholder return value for a buffered write AND mutate the
 * args so the parent applies the same synthetic ID the handler just saw.
 *
 * Most handlers don't read back from a write within the same job (the
 * audit confirms this), but several do `const m = await repos.x.create({...});`
 * followed by `await repos.x.update(m.id, …)` where `m.id` is consumed
 * synchronously. If the proxy generates one ID for the synthetic return
 * but lets the parent's real `create` invent a *different* ID, the
 * subsequent update fails ("not found"). So when we generate the ID we
 * write it back into args[0] before buffering — the buffered write now
 * has the same ID the handler is using.
 */
export function syntheticWriteResult(methodName: string, args: unknown[]): unknown {
  if (methodName.startsWith('create') && !methodName.startsWith('createBatch')) {
    // Repository create() methods follow the base shape:
    //   create(data: Omit<T, 'id'|'createdAt'|'updatedAt'>, options?: CreateOptions)
    // and the desired ID lives in `options.id`, not `data.id`
    // (see `lib/database/repositories/base.repository.ts:_create`).
    // Inject the synthetic ID into args[1] so the parent's real `_create`
    // uses the same ID we just handed back to the caller.
    const data = (args[0] && typeof args[0] === 'object') ? args[0] as Record<string, unknown> : {};
    const options = (args[1] && typeof args[1] === 'object') ? args[1] as Record<string, unknown> : {};
    if (typeof options.id !== 'string') {
      options.id = (typeof data.id === 'string') ? data.id : crypto.randomUUID();
      args[1] = options;
    }
    const now = new Date().toISOString();
    return { id: options.id, createdAt: now, updatedAt: now, ...data };
  }
  if (methodName.startsWith('upsert')) {
    if (args[0] && typeof args[0] === 'object') {
      const input = args[0] as Record<string, unknown>;
      if (typeof input.id !== 'string') {
        input.id = crypto.randomUUID();
      }
      return { ...input };
    }
    return { id: crypto.randomUUID() };
  }
  return undefined;
}

