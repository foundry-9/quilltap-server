/**
 * A memoised async thunk: `load` runs on the first call and every later call
 * shares its promise, so a value several readers might want costs one read
 * when any of them asks and nothing when none does.
 *
 * A failed load is not kept: the callers already waiting on it see the
 * failure, and the next call tries again — one transient failure must not
 * disable every later reader of the same value.
 */
export function lazyAsync<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    pending ??= load().catch(error => {
      pending = null
      throw error
    })
    return pending
  }
}
