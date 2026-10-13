/**
 * Child-side repository proxy
 *
 * Inside the forked job-runner child, `getRepositories()` returns this
 * proxy instead of the raw repository container. For each repository the
 * proxy intercepts method calls:
 *   - **Read methods** (whitelisted by name pattern or explicit override)
 *     pass through to the real repository, which queries the readonly
 *     SQLCipher connection.
 *   - **Write methods** push a `{ method, args }` payload into the
 *     per-job AsyncLocalStorage buffer and return a synthetic result
 *     synchronously. The real write never touches the readonly DB; the
 *     parent applies the batch later in a single transaction.
 *   - **Unknown methods** throw, so a new repository method that doesn't
 *     fit either pattern surfaces loudly instead of silently corrupting
 *     state.
 *
 * The audit in `docs/developer/BACKGROUND_JOBS_CHILD.md` produced the
 * override tables below. When adding a new repository method, classify
 * it there first.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { getRepositories as getRealRepositories } from '@/lib/database/repositories';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ChildWritePayload } from '../ipc-types';
import { logger } from '@/lib/logger';
import { runWithJobFolderCache } from './job-folder-cache';
import { cloneEquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { calculateReinforcedImportance } from '@/lib/memory/scoring/reinforced-importance';
import { appendCappedFootnotes } from '@/lib/memory/reinforcement-footnotes';

const log = logger.child({ module: 'jobs:child:proxy' });

// ============================================================================
// Per-job pending-writes buffer (AsyncLocalStorage)
// ============================================================================

interface JobScope {
  jobId: string;
  writes: ChildWritePayload[];
  /**
   * Set of repo.method strings appended during this job. Used to surface
   * read-your-writes regressions: if a read lands on a table already written
   * this job, log a warning so the regression is visible during testing.
   */
  recentlyWrittenKeys: Set<string>;
  /**
   * Per-job dedup of read-your-writes warnings so we don't spam the log
   * when a handler does many reads against the same table after a write.
   */
  warnedReads: Set<string>;
  /**
   * Count of write args down-converted by {@link sanitizeForIpc} this job.
   * Surfaced once per job in {@link flushPendingWrites} for observability.
   */
  sanitizedArgs: number;
  /**
   * Read-your-writes overlay for equipped outfits, keyed `chatId:characterId`.
   * Each buffered outfit write records the slots it will leave behind, and
   * `chats.getEquippedOutfitForCharacter` answers from here before the
   * snapshot — otherwise two outfit changes in one job compute from the same
   * stale baseline and the parent's replay keeps only the last (bug 179).
   */
  equippedOutfits: Map<string, EquippedSlots>;
  /**
   * Read-your-writes overlay for memory rows, keyed by memory id. A later step
   * of a job must see the job's own buffered inserts, links, footnotes, counts,
   * tier moves and deletes (bug 209). Admission no longer writes from here —
   * it runs in the parent over host-RPC (`admitMemory`) — but consolidation,
   * housekeeping, the fold passes and `retireMemories` still do.
   */
  memories: Map<string, MemoryOverlayEntry>;
  /**
   * Ids buffered `removeRelatedMemoryIdsEverywhere` calls scrub from every
   * row. Applied to every memories row a later read returns, whether or not
   * the job touched that row otherwise (bug 234).
   */
  memoryRelatedScrubs: Set<string>;
  /**
   * How many times this job attempt has admitted each candidate (by content
   * key). With the job id it makes admission's idempotency key: a retry of
   * the job is a new scope, so its counts restart and its candidates map to
   * the keys the failed attempt already admitted.
   */
  admissionOccurrences: Map<string, number>;
}

/** One memory row's buffered changes this job (see {@link JobScope.memories}). */
interface MemoryOverlayEntry {
  /** The whole row, when this job buffered its `create`. */
  created?: Record<string, unknown>;
  /** Absolute field patches, folded in order (last write wins, as on replay). */
  patch: Record<string, unknown>;
  /** Observations counted by buffered `incrementReinforcement` calls. */
  reinforcementDelta: number;
  lastReinforcedAt?: string;
  /**
   * Members buffered `removeConsolidatedMembers` calls took out of the row's
   * `consolidatedFrom` since its last absolute `consolidatedFrom` patch — a
   * delta applied to whatever list the row reads with.
   */
  consolidatedFromRemoved?: Set<string>;
  /**
   * Ids buffered `addRelatedMemoryIds` / `removeRelatedMemoryIds` calls add to
   * or take out of the row's `relatedMemoryIds` since its last absolute
   * `relatedMemoryIds` patch — deltas applied to whatever list the row reads
   * with (bug 231).
   */
  relatedAdded?: string[];
  relatedRemoved?: Set<string>;
  /**
   * Details buffered `appendReinforcementFootnotes` calls append, in order,
   * since the row's last absolute `content` patch (bug 231).
   */
  footnotes?: string[];
  deleted: boolean;
}

const jobScopeStore = new AsyncLocalStorage<JobScope>();

export function runWithJobScope<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const scope: JobScope = {
    jobId,
    writes: [],
    recentlyWrittenKeys: new Set(),
    warnedReads: new Set(),
    sanitizedArgs: 0,
    equippedOutfits: new Map(),
    memories: new Map(),
    memoryRelatedScrubs: new Set(),
    admissionOccurrences: new Map(),
  };
  // Nest a fresh per-job folder-ensure memo. It lives in its own
  // dependency-free module so lib/mount-index/folder-paths can read it via
  // getJobFolderEnsureCache without importing this heavy proxy (and the
  // repositories barrel it pulls in). See job-folder-cache.ts.
  return jobScopeStore.run(scope, () => runWithJobFolderCache(fn));
}

/**
 * The idempotency key for one admission in the running job attempt:
 * `jobId:contentKey:n`, where `n` counts earlier admissions of the same
 * content in this attempt. Null outside a job scope.
 */
export function nextAdmissionKey(contentKey: string): string | null {
  const scope = jobScopeStore.getStore();
  if (!scope) return null;
  const n = scope.admissionOccurrences.get(contentKey) ?? 0;
  scope.admissionOccurrences.set(contentKey, n + 1);
  return `${scope.jobId}:${contentKey}:${n}`;
}

export function flushPendingWrites(): ChildWritePayload[] {
  const scope = jobScopeStore.getStore();
  if (!scope) return [];
  const writes = scope.writes.slice();
  if (scope.sanitizedArgs > 0) {
    log.debug('Down-converted Float32Array write args for IPC transport', {
      jobId: scope.jobId,
      writeCount: writes.length,
      sanitizedArgs: scope.sanitizedArgs,
    });
  }
  scope.writes.length = 0;
  return writes;
}

/**
 * Convert IPC-hostile values in a buffered write's args into structured-clone-
 * and JSON-safe equivalents before they cross the child→parent boundary.
 *
 * Embeddings are produced as `Float32Array` (see `applyEmbeddingProfile`). The
 * job-runner child ships buffered writes to the parent over the fork IPC
 * channel; if that channel's effective serialization is not `'advanced'`
 * (V8 structured-clone), a `Float32Array` arrives at the parent as a plain
 * object and fails the repository embedding schemas. Every embedding schema
 * also accepts a plain `number[]` and transforms it back into a `Float32Array`
 * on validation, so down-converting here is lossless and independent of the
 * channel's serialization mode.
 *
 * Only `Float32Array` is rewritten. `Buffer`/other typed-array views are left
 * intact (reinterpreting their bytes as numbers would corrupt them), and class
 * instances / Maps / etc. are left for the IPC layer to handle. Objects and
 * arrays are rebuilt only when they actually contain a `Float32Array`, so the
 * common no-embedding write incurs no copy and the caller's in-memory args are
 * never mutated.
 */
function sanitizeForIpc(value: unknown, depth = 0): unknown {
  if (value instanceof Float32Array) {
    return Array.from(value);
  }
  if (value === null || typeof value !== 'object' || depth > 8) {
    return value;
  }
  // Buffers and other typed-array views (Uint8Array, etc.) are left as-is.
  if (ArrayBuffer.isView(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const s = sanitizeForIpc(v, depth + 1);
      if (s !== v) changed = true;
      return s;
    });
    return changed ? out : value;
  }
  // Only descend into plain objects; leave class instances / Maps untouched.
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = sanitizeForIpc(v, depth + 1);
      if (s !== v) changed = true;
      out[k] = s;
    }
    return changed ? out : value;
  }
  return value;
}

export function appendWrite(method: string, args: unknown[]): void {
  const scope = jobScopeStore.getStore();
  if (!scope) {
    throw new Error(`Cannot append write "${method}" outside of a job scope`);
  }
  const safeArgs = args.map((a) => {
    const sanitized = sanitizeForIpc(a);
    if (sanitized !== a) scope.sanitizedArgs++;
    return sanitized;
  });
  scope.writes.push({ method, args: safeArgs });
  scope.recentlyWrittenKeys.add(method);
}

// ============================================================================
// Equipped-outfit read-your-writes overlay (bug 179)
// ============================================================================

function equippedOutfitKey(chatId: unknown, characterId: unknown): string | null {
  return typeof chatId === 'string' && typeof characterId === 'string'
    ? `${chatId}:${characterId}`
    : null;
}

/**
 * Record the slots a buffered `wardrobeWear.commitEquippedOutfit` leaves
 * behind, so later reads in the same job see them. The chokepoint is the only
 * slot writer (the equip-chokepoint fence enforces it), so it is the only
 * write this overlay needs to follow.
 */
function recordBufferedOutfitWrite(scope: JobScope, fqn: string, args: unknown[]): void {
  if (fqn !== 'wardrobeWear.commitEquippedOutfit') return;
  const input = args[0] as { chatId?: unknown; characterId?: unknown; nextSlots?: unknown } | undefined;
  const key = equippedOutfitKey(input?.chatId, input?.characterId);
  const slots = input?.nextSlots;
  if (!key || !slots || typeof slots !== 'object') return;
  scope.equippedOutfits.set(key, cloneEquippedSlots(slots as EquippedSlots));
  log.debug('Recorded buffered outfit write for in-job reads', { jobId: scope.jobId, key });
}

/** The job's own buffered slots for a character, or undefined to read the snapshot. */
function bufferedOutfitFor(scope: JobScope | undefined, args: unknown[]): EquippedSlots | undefined {
  if (!scope || scope.equippedOutfits.size === 0) return undefined;
  const key = equippedOutfitKey(args[0], args[1]);
  const slots = key ? scope.equippedOutfits.get(key) : undefined;
  return slots ? cloneEquippedSlots(slots) : undefined;
}

// ============================================================================
// Memory read-your-writes overlay (bug 209)
// ============================================================================

function memoryOverlayEntry(scope: JobScope, id: string): MemoryOverlayEntry {
  let entry = scope.memories.get(id);
  if (!entry) {
    entry = { patch: {}, reinforcementDelta: 0, deleted: false };
    scope.memories.set(id, entry);
  }
  return entry;
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Record what a buffered memory write will leave behind, so later reads in the
 * same job see it. Covers every memories write consolidation, housekeeping,
 * the fold passes and the delete chokepoint issue; the parent's replay is
 * unchanged.
 */
function recordBufferedMemoryWrite(
  scope: JobScope,
  methodName: string,
  args: unknown[],
  result: unknown,
): void {
  switch (methodName) {
    case 'create': {
      const row = result as Record<string, unknown> | undefined;
      const id = asId(row?.id);
      if (!id || !row) return;
      const entry = memoryOverlayEntry(scope, id);
      entry.created = {
        tier: 'hot',
        consolidatedFrom: [],
        relatedMemoryIds: [],
        reinforcementCount: 1,
        ...row,
      };
      entry.deleted = false;
      break;
    }
    case 'update':
    case 'updateForCharacter': {
      const id = asId(methodName === 'update' ? args[0] : args[1]);
      const patch = methodName === 'update' ? args[1] : args[2];
      if (!id || !patch || typeof patch !== 'object') return;
      const entry = memoryOverlayEntry(scope, id);
      Object.assign(entry.patch, patch);
      // An absolute list replaces any deltas buffered before it.
      if ('consolidatedFrom' in patch) entry.consolidatedFromRemoved = undefined;
      if ('relatedMemoryIds' in patch) {
        entry.relatedAdded = undefined;
        entry.relatedRemoved = undefined;
      }
      if ('content' in patch) entry.footnotes = undefined;
      break;
    }
    case 'addRelatedMemoryIds':
    case 'removeRelatedMemoryIds': {
      const id = asId(args[1]);
      const ids = Array.isArray(args[2]) ? args[2].filter((m): m is string => typeof m === 'string') : [];
      if (!id || ids.length === 0) return;
      const entry = memoryOverlayEntry(scope, id);
      const added = entry.relatedAdded ?? [];
      const removed = entry.relatedRemoved ?? new Set<string>();
      if (methodName === 'addRelatedMemoryIds') {
        for (const m of ids) {
          removed.delete(m);
          if (m !== id && !added.includes(m)) added.push(m);
        }
      } else {
        for (const m of ids) {
          removed.add(m);
          const at = added.indexOf(m);
          if (at !== -1) added.splice(at, 1);
        }
      }
      entry.relatedAdded = added;
      entry.relatedRemoved = removed;
      break;
    }
    case 'removeRelatedMemoryIdsEverywhere': {
      const ids = Array.isArray(args[0]) ? args[0].filter((m): m is string => typeof m === 'string') : [];
      for (const m of ids) scope.memoryRelatedScrubs.add(m);
      break;
    }
    case 'appendReinforcementFootnotes': {
      const id = asId(args[1]);
      const details = Array.isArray(args[2]) ? args[2].filter((d): d is string => typeof d === 'string') : [];
      if (!id || details.length === 0) return;
      const entry = memoryOverlayEntry(scope, id);
      entry.footnotes = [...(entry.footnotes ?? []), ...details];
      break;
    }
    case 'removeConsolidatedMembers': {
      const id = asId(args[1]);
      const members = Array.isArray(args[2]) ? args[2].filter((m): m is string => typeof m === 'string') : [];
      if (!id || members.length === 0) return;
      const entry = memoryOverlayEntry(scope, id);
      const removed = entry.consolidatedFromRemoved ?? new Set<string>();
      for (const m of members) removed.add(m);
      entry.consolidatedFromRemoved = removed;
      break;
    }
    case 'incrementReinforcement': {
      const id = asId(args[1]);
      if (!id) return;
      const entry = memoryOverlayEntry(scope, id);
      const by = typeof args[3] === 'number' ? args[3] : 1;
      entry.reinforcementDelta += by;
      const at = asId(args[2]);
      if (at && (!entry.lastReinforcedAt || at > entry.lastReinforcedAt)) entry.lastReinforcedAt = at;
      break;
    }
    case 'updateTierBulk': {
      const ids = Array.isArray(args[1]) ? args[1] : [];
      const extra = args[3] && typeof args[3] === 'object' ? args[3] : {};
      for (const raw of ids) {
        const id = asId(raw);
        if (!id) continue;
        const supersededById = (extra as { supersededById?: unknown }).supersededById;
        const supersession = supersededById === undefined
          ? {}
          : { supersededAt: supersededById ? new Date().toISOString() : null };
        Object.assign(memoryOverlayEntry(scope, id).patch, { tier: args[2] }, extra, supersession);
      }
      break;
    }
    case 'bulkDeleteUnsafe': {
      const ids = Array.isArray(args[1]) ? args[1] : [];
      for (const raw of ids) {
        const id = asId(raw);
        if (id) memoryOverlayEntry(scope, id).deleted = true;
      }
      break;
    }
    default:
      return;
  }
  log.debug('Recorded buffered memory write for in-job reads', { jobId: scope.jobId, method: methodName });
}

/** A row as this job will leave it, or null when the job deleted it. */
function readIdList(value: unknown): unknown[] | null {
  let list: unknown = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (list === null || list === undefined) return [];
  return Array.isArray(list) ? list : null;
}

/** Apply the job's buffered link scrubs to a row read this job (bug 234). */
function scrubRelatedLinks(scope: JobScope, row: Record<string, unknown>): Record<string, unknown> {
  const scrubbed = scope.memoryRelatedScrubs;
  if (scrubbed.size === 0) return row;
  const list = readIdList(row.relatedMemoryIds);
  if (!list || !list.some((m) => scrubbed.has(m as string))) return row;
  return { ...row, relatedMemoryIds: list.filter((m) => !scrubbed.has(m as string)) };
}

function overlayMemoryRow(
  base: Record<string, unknown>,
  entry: MemoryOverlayEntry | undefined,
  scope: JobScope,
): Record<string, unknown> | null {
  if (!entry) return scrubRelatedLinks(scope, base);
  if (entry.deleted) return null;
  const row: Record<string, unknown> = { ...base, ...entry.patch };
  if (entry.relatedAdded?.length || entry.relatedRemoved?.size) {
    const removed = entry.relatedRemoved ?? new Set<string>();
    const list = (readIdList(row.relatedMemoryIds) ?? []).filter((m) => !removed.has(m as string));
    for (const m of entry.relatedAdded ?? []) if (!list.includes(m)) list.push(m);
    row.relatedMemoryIds = list;
  }
  if (entry.footnotes?.length && typeof row.content === 'string') {
    row.content = appendCappedFootnotes(row.content, entry.footnotes).content;
  }
  if (entry.consolidatedFromRemoved && entry.consolidatedFromRemoved.size > 0) {
    const removed = entry.consolidatedFromRemoved;
    let list: unknown = row.consolidatedFrom;
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch { list = []; }
    }
    if (Array.isArray(list)) row.consolidatedFrom = list.filter((m) => !removed.has(m as string));
  }
  if (entry.reinforcementDelta > 0) {
    const baseCount = typeof base.reinforcementCount === 'number' ? base.reinforcementCount : 1;
    const reinforcementCount = baseCount + entry.reinforcementDelta;
    const importance = typeof row.importance === 'number' ? row.importance : 0.5;
    row.reinforcementCount = reinforcementCount;
    row.reinforcedImportance = calculateReinforcedImportance(importance, reinforcementCount);
    const prior = typeof base.lastReinforcedAt === 'string' ? base.lastReinforcedAt : null;
    if (entry.lastReinforcedAt && (!prior || entry.lastReinforcedAt > prior)) {
      row.lastReinforcedAt = entry.lastReinforcedAt;
    }
  }
  return scrubRelatedLinks(scope, row);
}

/**
 * Memories reads that answer from the overlay. The id-addressed reads also
 * return rows this job created; the source-message read (the fold episode
 * pass's fragment lookup) returns this job's matching creates too. Other
 * reads have their returned rows patched, never extended.
 */
const MEMORY_OVERLAY_READS = new Set([
  'findById',
  'findByIdForCharacter',
  'findByIds',
  'findByCharacterAndSourceMessageIds',
]);

function looksLikeRow(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string';
}

/** Rows this job created that a read should add, given its arguments. */
function createdRowsFor(scope: JobScope, methodName: string, args: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const [id, entry] of scope.memories) {
    const created = entry.created;
    if (!created) continue;
    let wanted = false;
    switch (methodName) {
      case 'findById':
        wanted = args[0] === id;
        break;
      case 'findByIdForCharacter':
        wanted = args[1] === id && created.characterId === args[0];
        break;
      case 'findByIds':
        wanted = Array.isArray(args[0]) && args[0].includes(id);
        break;
      case 'findByCharacterAndSourceMessageIds': {
        const sources = Array.isArray(args[1]) ? args[1] : [];
        const patchedSource = 'sourceMessageId' in entry.patch ? entry.patch.sourceMessageId : created.sourceMessageId;
        wanted = created.characterId === args[0] && typeof patchedSource === 'string' && sources.includes(patchedSource);
        break;
      }
      default:
        wanted = false;
    }
    if (wanted) out.push(created);
  }
  return out;
}

/** Apply the job's memory overlay to a memories read's result. */
function applyMemoryOverlay(scope: JobScope, methodName: string, args: unknown[], result: unknown): unknown {
  const adds = MEMORY_OVERLAY_READS.has(methodName);
  if (Array.isArray(result)) {
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const item of result) {
      if (!looksLikeRow(item)) {
        out.push(item);
        continue;
      }
      seen.add(item.id as string);
      const entry = scope.memories.get(item.id as string);
      const row = overlayMemoryRow(entry?.created ?? item, entry, scope);
      if (row) out.push(row);
    }
    if (adds) {
      for (const created of createdRowsFor(scope, methodName, args)) {
        if (seen.has(created.id as string)) continue;
        const row = overlayMemoryRow(created, scope.memories.get(created.id as string), scope);
        if (row) out.push(row);
      }
    }
    return out;
  }
  if (looksLikeRow(result)) {
    const entry = scope.memories.get(result.id as string);
    return overlayMemoryRow(entry?.created ?? result, entry, scope);
  }
  if ((result === null || result === undefined) && adds) {
    const [created] = createdRowsFor(scope, methodName, args);
    if (created) return overlayMemoryRow(created, scope.memories.get(created.id as string), scope);
  }
  return result;
}

// ============================================================================
// Method classification
// ============================================================================

const READ_PREFIXES = ['find', 'get', 'list', 'count', 'search', 'has', 'exists', 'is', 'fetch', 'query', 'load', 'read'];
const WRITE_PREFIXES = ['create', 'update', 'delete', 'upsert', 'bulk', 'set', 'mark', 'reset', 'cleanup', 'clear', 'increment', 'decrement', 'add', 'remove', 'cancel', 'touch', 'save'];

/**
 * Explicit overrides for methods whose names don't match the prefixes above.
 * Format: `'<repoKey>.<methodName>': 'read' | 'write'`.
 */
const METHOD_OVERRIDES: Record<string, 'read' | 'write'> = {
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
 * Methods that must NOT run through the child proxy — neither as a read (the
 * child's DB is readonly) nor as a buffered write — because a buffered write
 * cannot satisfy a caller that consumes the method's *generated* row ids within
 * the same job.
 *
 * Unlike {@link FORBIDDEN_METHODS} (which fall through to the generic
 * "not classified" hint), these throw a tailored message so a future maintainer
 * doesn't "fix" the throw with a naive `METHOD_OVERRIDES = 'write'` entry — that
 * would actively corrupt state rather than fail loudly.
 *
 * `linkFilesystemFile` find-or-creates a file row + link row and returns their
 * ids; its in-child callers (`scanner.processMountFile`, `reindexSingleFile`'s
 * filesystem branch — both reached via doc_copy/doc_move to a *filesystem* mount
 * and fire-and-forget reindex during a turn) immediately read `link.id` to insert
 * chunk rows. A buffered write returns `undefined` (so `.id` throws) and, even
 * with a synthetic id, the parent's real `linkFilesystemFile` mints its own link
 * id, so the buffered chunks would dangle and the link's `chunkCount` would lie.
 * This path must run on the parent (host-RPC) or be deferred; it is not
 * child-safe. The throw is always caught by those best-effort callers, so the
 * file is written but left unindexed — the same soft-fail as before this entry.
 */
const CHILD_UNSUPPORTED_METHODS: Record<string, string> = {
  'docMountFileLinks.linkFilesystemFile':
    'it find-or-creates a file+link row and returns ids that its callers ' +
    '(scanner.processMountFile, reindexSingleFile) consume to insert chunk rows; ' +
    'a buffered write cannot supply the parent-generated id, so chunks would ' +
    'dangle. Run it on the parent (host-RPC) or defer it — see ' +
    'docs/developer/BACKGROUND_JOBS_CHILD.md.',
};

/**
 * Repository methods that should never be exposed inside the child — they
 * spawn LLM calls, manage processor state, or are transactional helpers
 * that must run on the parent.
 */
const FORBIDDEN_METHODS: Set<string> = new Set([
  'backgroundJobs.claimNextJob',
  'backgroundJobs.findNextScheduledAt',
  'backgroundJobs.markCompleted',
  'backgroundJobs.markFailed',
  'backgroundJobs.resetAllProcessingJobs',
  'backgroundJobs.resetStuckJobs',
]);

/**
 * Sub-table resolvers for repositories that own more than one table.
 *
 * The read-your-writes detector below compares a read against the buffered
 * writes, and its grouping key decides what counts as "the same data". The
 * repository object is the wrong granularity for a repo spanning several
 * tables: `connections` owns both `connection_profiles` and `api_keys`, so
 * every `AUTONOMOUS_ROOM_TURN` produced a warning pairing the buffered
 * `connections.incrementTokenUsage` (a counter bump on `connection_profiles`)
 * with a later `connections.findApiKeyByIdAndUserId` (a `SELECT` from
 * `api_keys`) — two tables that cannot stale each other. One line per turn,
 * forever, for a condition that does not exist.
 *
 * A resolver maps a method name to the table it touches, so reads and writes
 * are only compared when they land on the same one. Add an entry when a new
 * repository fronts multiple tables; repos absent from this map are treated
 * as a single group (the previous behaviour).
 */
const TABLE_GROUP_RESOLVERS: Record<string, (methodName: string) => string> = {
  // Every api_keys method carries "ApiKey" in its name (getApiKeysByUserId,
  // findApiKeyById, createApiKey, updateApiKey, deleteApiKey,
  // recordApiKeyUsage, findApiKeyByIdAndUserId); everything else on this repo
  // operates on connection_profiles.
  connections: (methodName) => (/ApiKey/.test(methodName) ? 'api_keys' : 'connection_profiles'),
};

/**
 * Grouping key for the read-your-writes heuristic: the table a call touches,
 * as best we can tell from its name. Falls back to the repository key so an
 * unmapped repo behaves exactly as it did before table groups existed.
 */
function tableGroup(repoKey: string, methodName: string): string {
  const resolver = TABLE_GROUP_RESOLVERS[repoKey];
  return resolver ? `${repoKey}.${resolver(methodName)}` : repoKey;
}

/** Same, for an already-buffered `<repoKey>.<methodName>` write key. */
function tableGroupForWriteKey(writeKey: string): string {
  const dot = writeKey.indexOf('.');
  if (dot === -1) return writeKey;
  return tableGroup(writeKey.slice(0, dot), writeKey.slice(dot + 1));
}

function classifyMethod(repoKey: string, methodName: string): 'read' | 'write' | 'unknown' {
  const fqn = `${repoKey}.${methodName}`;

  if (FORBIDDEN_METHODS.has(fqn)) return 'unknown';
  // Child-unsupported methods stay 'unknown' (→ tailored throw in wrapRepo) even
  // if a future prefix change would otherwise classify them as a write.
  if (CHILD_UNSUPPORTED_METHODS[fqn]) return 'unknown';
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
function syntheticWriteResult(methodName: string, args: unknown[]): unknown {
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

// ============================================================================
// Proxy construction
// ============================================================================

function wrapRepo<T extends object>(repoKey: string, instance: T): T {
  return new Proxy(instance, {
    get(target, prop) {
      const key = String(prop);
      const real = (target as Record<string, unknown>)[key];

      // Non-function properties pass through unchanged.
      if (typeof real !== 'function') return real;

      const classification = classifyMethod(repoKey, key);

      if (classification === 'read') {
        // Diagnostic: warn (once per (jobId, readMethod)) if a read hits a
        // table recently appended to the pending-writes buffer. Heuristic —
        // checks the table a method name implies, not row identity — but
        // enough to flag suspicious patterns during testing without spamming
        // the log. See TABLE_GROUP_RESOLVERS for why the grouping key is the
        // table rather than the repository object.
        return (...args: unknown[]) => {
          const scope = jobScopeStore.getStore();
          if (repoKey === 'chats' && key === 'getEquippedOutfitForCharacter') {
            const buffered = bufferedOutfitFor(scope, args);
            if (buffered) return Promise.resolve(buffered);
          }
          // Bug 209: memories reads see the job's own buffered writes. The
          // id-addressed reads in MEMORY_OVERLAY_READS are answered in full,
          // so the read-your-writes warning below would be a false alarm for
          // them; other memories reads still warn (a buffered create cannot
          // join a filtered query) but have the rows they return patched.
          const overlaid = repoKey === 'memories' && !!scope
            && (scope.memories.size > 0 || scope.memoryRelatedScrubs.size > 0);
          if (scope && scope.recentlyWrittenKeys.size > 0 && !(overlaid && MEMORY_OVERLAY_READS.has(key))) {
            const readKey = `${repoKey}.${key}`;
            if (!scope.warnedReads.has(readKey)) {
              const readGroup = tableGroup(repoKey, key);
              for (const writtenKey of scope.recentlyWrittenKeys) {
                if (tableGroupForWriteKey(writtenKey) === readGroup) {
                  scope.warnedReads.add(readKey);
                  log.warn('Read after buffered write on same table — possible read-your-writes issue', {
                    jobId: scope.jobId,
                    readMethod: readKey,
                    table: readGroup,
                    bufferedWrites: Array.from(scope.recentlyWrittenKeys),
                  });
                  break;
                }
              }
            }
          }
          const answered = (real as (...a: unknown[]) => unknown).apply(target, args);
          // Async iterators (the batched corpus reads) pass through untouched.
          if (overlaid && answered && typeof (answered as PromiseLike<unknown>).then === 'function') {
            return (answered as Promise<unknown>).then((res) => applyMemoryOverlay(scope!, key, args, res));
          }
          return answered;
        };
      }

      if (classification === 'write') {
        return (...args: unknown[]) => {
          // Generate the synthetic result first — for create/upsert this
          // also injects an ID into args[1] (CreateOptions), so the
          // buffered write the parent applies uses the same ID the
          // caller now has.
          const result = syntheticWriteResult(key, args);
          appendWrite(`${repoKey}.${key}`, args);
          const scope = jobScopeStore.getStore();
          if (scope) recordBufferedOutfitWrite(scope, `${repoKey}.${key}`, args);
          if (scope && repoKey === 'memories') recordBufferedMemoryWrite(scope, key, args, result);
          // Real repository write methods are async; mirror that here so
          // callers that chain `.then` / `.catch` / `Promise.all` against
          // the proxy don't trip on a synchronous `undefined`.
          return Promise.resolve(result);
        };
      }

      // Unknown — throw at call time so the offending handler is named
      // in the stack trace, not at proxy construction time.
      return () => {
        const fqn = `${repoKey}.${key}`;
        const unsupportedReason = CHILD_UNSUPPORTED_METHODS[fqn];
        if (unsupportedReason) {
          throw new Error(
            `Repository method "${fqn}" cannot run in the job child: ${unsupportedReason}`
          );
        }
        throw new Error(
          `Repository method "${fqn}" is not classified for child execution. ` +
          `Add it to METHOD_OVERRIDES in lib/background-jobs/child/child-repositories-proxy.ts.`
        );
      };
    },
  });
}

let cachedProxyContainer: RepositoryContainer | null = null;

/**
 * Test-only: drops the cached proxy container so the next call to
 * `getChildRepositoriesProxy()` re-wraps a fresh repo set. The production
 * runtime never calls this — the child has one repo container for its
 * entire lifetime.
 */
export function __resetProxyCacheForTesting(): void {
  cachedProxyContainer = null;
}

export function getChildRepositoriesProxy(): RepositoryContainer {
  if (cachedProxyContainer) return cachedProxyContainer;

  const real = getRealRepositories();

  // Build a wrapping object whose own keys mirror the real container, but
  // whose values are repo-Proxy wrappers. We can't Proxy the container
  // itself because property access patterns inside Quilltap include
  // `repos.memories.create` called directly — and we want the inner Proxy to be
  // returned synchronously.
  const wrapped: Record<string, unknown> = {};
  for (const key of Object.keys(real) as Array<keyof RepositoryContainer>) {
    const inst = real[key] as unknown;
    if (inst && typeof inst === 'object') {
      wrapped[key as string] = wrapRepo(key as string, inst as object);
    } else {
      wrapped[key as string] = inst;
    }
  }
  cachedProxyContainer = wrapped as unknown as RepositoryContainer;
  return cachedProxyContainer;
}
