/**
 * Process-wide singletons that survive module duplication.
 *
 * Next.js may evaluate one source module several times in a single Node
 * process: the instrumentation bundle (the job dispatcher and its host-RPC
 * handlers live there) and each route bundle get their own copy, and the dev
 * server's HMR re-evaluates modules freely. A module-level `const cache = new
 * Map()` is therefore one cache *per copy*, and a write or invalidation made
 * through one copy is invisible to the others (bug 235: the dispatcher dropped
 * its copy of a character's vector cache after a reindex while chat recall
 * kept searching its own, pre-reindex copy).
 *
 * State whose meaning is "one per process" — caches something else
 * invalidates, locks, counters, debounce timers — goes through
 * {@link processSingleton}, which keeps it on `globalThis` under a
 * `Symbol.for` key so every copy of the module shares it.
 *
 * @module utils/process-singleton
 */

const REGISTRY_KEY = Symbol.for('quilltap.processSingletons')

type Registry = Map<string, unknown>

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>
  let reg = g[REGISTRY_KEY]
  if (!reg) {
    reg = new Map()
    g[REGISTRY_KEY] = reg
  }
  return reg
}

/**
 * The process's one value for `key`, created by `create` on first use.
 *
 * Keys are global: name them after the owning module
 * (`'memory.frozenArchiveCache'`). The value is created once per process and
 * never replaced, so a re-evaluated module keeps the state its predecessor
 * built.
 */
export function processSingleton<T>(key: string, create: () => T): T {
  const reg = registry()
  if (!reg.has(key)) reg.set(key, create())
  return reg.get(key) as T
}
