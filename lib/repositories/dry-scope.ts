/**
 * Dry scope — run code that must write nothing.
 *
 * Inside {@link runDry}, `getRepositories()` hands back a wrapper over the real
 * repositories: reads pass through, and every write (by the same name rules as
 * the job child's proxy, `method-classification.ts`) is discarded with a
 * synthetic result. The one exception is the LLM log, which a dry run still
 * records — every LLM call is logged, a dry one included.
 *
 * Its first user is the storyteller bid (`lib/storyteller/bid.service.ts`),
 * which builds a character's full turn context — the same identity stack,
 * recall and transcript as a real turn — without posting a whisper, stamping
 * a memory, consuming an inform or advancing a cycle. The `purpose: 'bid'`
 * flag on the turn path skips the work whose only point is a write; this scope
 * is the guarantee that nothing it missed reaches the database.
 *
 * What it cannot see: writes that bypass the repository container (raw SQL
 * through a database handle, file-system writes). The bid path is held to
 * repository calls by its tests.
 *
 * @module repositories/dry-scope
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '@/lib/logger';
import { classifyRepositoryMethod, syntheticWriteResult } from './method-classification';
import type { RepositoryContainer } from './factory';

interface DryScope {
  label: string;
  /** `<repo>.<method>` → number of writes discarded. */
  discarded: Map<string, number>;
}

const dryScopeStore = new AsyncLocalStorage<DryScope>();

/** Repositories whose writes still land inside a dry scope. */
const DRY_SCOPE_PASS_THROUGH_REPOS = new Set(['llmLogs']);

/** Run `fn` with every repository write discarded (see the module note). */
export async function runDry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const scope: DryScope = { label, discarded: new Map() };
  try {
    return await dryScopeStore.run(scope, fn);
  } finally {
    if (scope.discarded.size > 0) {
      logger.debug('Dry scope discarded writes', {
        context: 'dry-scope',
        label,
        discarded: Object.fromEntries(scope.discarded),
      });
    }
  }
}

/** True inside {@link runDry}. */
export function isInDryScope(): boolean {
  return dryScopeStore.getStore() !== undefined;
}

/** The writes the current dry scope has discarded so far (tests, diagnostics). */
export function dryScopeDiscardedWrites(): ReadonlyMap<string, number> {
  return dryScopeStore.getStore()?.discarded ?? new Map();
}

const wrappedContainers = new WeakMap<RepositoryContainer, RepositoryContainer>();

/** The dry wrapper over a real container (cached per container). */
export function dryRepositories(real: RepositoryContainer): RepositoryContainer {
  const cached = wrappedContainers.get(real);
  if (cached) return cached;
  const repoCache = new Map<string, unknown>();
  const container = new Proxy(real, {
    get(target, prop) {
      const value = (target as unknown as Record<string, unknown>)[String(prop)];
      if (!value || typeof value !== 'object' || typeof prop !== 'string') return value;
      if (DRY_SCOPE_PASS_THROUGH_REPOS.has(prop)) return value;
      let wrapped = repoCache.get(prop);
      if (!wrapped) {
        wrapped = wrapRepo(prop, value as object);
        repoCache.set(prop, wrapped);
      }
      return wrapped;
    },
  });
  wrappedContainers.set(real, container);
  return container;
}

function wrapRepo<T extends object>(repoKey: string, instance: T): T {
  return new Proxy(instance, {
    get(target, prop) {
      const key = String(prop);
      const real = (target as Record<string, unknown>)[key];
      if (typeof real !== 'function') return real;
      // Outside a dry scope (a container captured inside one and used after)
      // the wrapper is transparent.
      const kind = classifyRepositoryMethod(repoKey, key);
      // Bound to the real instance, so the repository's own internal calls
      // (`this.safeQuery`, `this.getCollection`) never pass back through here.
      if (kind === 'read') return (real as (...a: unknown[]) => unknown).bind(target);
      return (...args: unknown[]) => {
        const scope = dryScopeStore.getStore();
        if (!scope) return (real as (...a: unknown[]) => unknown).apply(target, args);
        const fqn = `${repoKey}.${key}`;
        if (kind === 'unknown') {
          // Fail safe: an unclassified method is treated as a write. Warned
          // once per scope so a read with an odd name gets classified.
          if (!scope.discarded.has(fqn)) {
            logger.warn('Dry scope discarded an unclassified repository method', {
              context: 'dry-scope',
              label: scope.label,
              method: fqn,
            });
          }
        }
        scope.discarded.set(fqn, (scope.discarded.get(fqn) ?? 0) + 1);
        return Promise.resolve(syntheticWriteResult(key, args) ?? dryAddResult(key, args));
      };
    },
  });
}

/** `add*` writers (e.g. `chats.addMessage`) hand back the row they were given. */
function dryAddResult(methodName: string, args: unknown[]): unknown {
  if (!methodName.startsWith('add')) return undefined;
  const row = args.find((arg) => arg && typeof arg === 'object' && !Array.isArray(arg)) as
    | Record<string, unknown>
    | undefined;
  return row ? { ...row } : undefined;
}
