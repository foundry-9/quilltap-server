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

const log = logger.child({ module: 'jobs:child:proxy' });

// ============================================================================
// Per-job pending-writes buffer (AsyncLocalStorage)
// ============================================================================

interface JobScope {
  jobId: string;
  writes: ChildWritePayload[];
  /**
   * Set of repo.method strings appended during this job. Used to surface
   * read-your-writes regressions: if a read method matches a key recently
   * written, log a warning so the regression is visible during testing.
   */
  recentlyWrittenKeys: Set<string>;
  /**
   * Per-job dedup of read-your-writes warnings so we don't spam the log
   * when a handler does many reads against the same repo after a write.
   */
  warnedReads: Set<string>;
}

const jobScopeStore = new AsyncLocalStorage<JobScope>();

export function runWithJobScope<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const scope: JobScope = { jobId, writes: [], recentlyWrittenKeys: new Set(), warnedReads: new Set() };
  return jobScopeStore.run(scope, fn);
}

export function flushPendingWrites(): ChildWritePayload[] {
  const scope = jobScopeStore.getStore();
  if (!scope) return [];
  const writes = scope.writes.slice();
  scope.writes.length = 0;
  return writes;
}

export function appendWrite(method: string, args: unknown[]): void {
  const scope = jobScopeStore.getStore();
  if (!scope) {
    throw new Error(`Cannot append write "${method}" outside of a job scope`);
  }
  scope.writes.push({ method, args });
  scope.recentlyWrittenKeys.add(method);
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
  'vectorIndices.entryExists': 'read',

  // ---- Writes with non-conforming names ------------------------------------
  // memories
  'memories.updateForCharacter': 'write',
  // chats
  'chats.updateMessage': 'write',
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
  // llm logs
  'llmLogs.cleanupOldLogs': 'write',
  // vector indices
  'vectorIndices.addEntry': 'write',
  'vectorIndices.updateEntryEmbedding': 'write',
  'vectorIndices.saveMeta': 'write',
  'vectorIndices.deleteStore': 'write',
  // conversation chunks
  'conversationChunks.upsert': 'write',
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

function classifyMethod(repoKey: string, methodName: string): 'read' | 'write' | 'unknown' {
  const fqn = `${repoKey}.${methodName}`;

  if (FORBIDDEN_METHODS.has(fqn)) return 'unknown';
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
        // key recently appended to the pending-writes buffer. Heuristic —
        // checks method name, not row identity — but enough to flag
        // suspicious patterns during testing without spamming the log.
        return (...args: unknown[]) => {
          const scope = jobScopeStore.getStore();
          if (scope && scope.recentlyWrittenKeys.size > 0) {
            const readKey = `${repoKey}.${key}`;
            if (!scope.warnedReads.has(readKey)) {
              for (const writtenKey of scope.recentlyWrittenKeys) {
                if (writtenKey.startsWith(`${repoKey}.`)) {
                  scope.warnedReads.add(readKey);
                  log.warn('Read after buffered write on same repo — possible read-your-writes issue', {
                    jobId: scope.jobId,
                    readMethod: readKey,
                    bufferedWrites: Array.from(scope.recentlyWrittenKeys),
                  });
                  break;
                }
              }
            }
          }
          return (real as (...a: unknown[]) => unknown).apply(target, args);
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
          return result;
        };
      }

      // Unknown — throw at call time so the offending handler is named
      // in the stack trace, not at proxy construction time.
      return () => {
        throw new Error(
          `Repository method "${repoKey}.${key}" is not classified for child execution. ` +
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
  // `repos.memories.create(...)` — and we want the inner Proxy to be
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
