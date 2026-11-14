/**
 * Per-key write serialisation for a find-then-create upsert (#207).
 *
 * The parent process is the only database writer, but a repository method is
 * a chain of awaits: two callers upserting the same key can both read "no row"
 * before either inserts. On a table with the unique constraint the loser takes
 * a `UNIQUE constraint failed`; on an older table built without it, a duplicate
 * row lands. Running every upsert for one key behind the previous one closes
 * the window in-process; the constraint (where present) remains the backstop
 * for anything outside it, resolved by the caller to the winning row.
 *
 * @module database/repositories/keyed-write-chain
 */

import { processSingleton } from '@/lib/utils/process-singleton';

/**
 * Make a serialiser for one family of keys. `name` must be unique per family:
 * the chain map is a process singleton (a module-level map is per bundle —
 * bug 235). Never re-enter the same key from inside `fn`.
 */
export function createKeyedWriteChain(name: string) {
  const chains = processSingleton(
    `keyed-write-chain.${name}`,
    () => new Map<string, Promise<unknown>>(),
  );

  return function runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    chains.set(key, next);
    void next
      .catch(() => {})
      .finally(() => {
        if (chains.get(key) === next) chains.delete(key);
      });
    return next;
  };
}
