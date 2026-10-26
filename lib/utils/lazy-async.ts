/**
 * A memoised async thunk: `load` runs on the first call and every later call
 * shares its promise, so a value several readers might want costs one read
 * when any of them asks and nothing when none does.
 *
 * The promise is memoised, rejection included — a load that failed is not
 * retried behind its callers' backs; each one sees the same failure and
 * handles it as it would have handled its own read.
 */
export function lazyAsync<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    pending ??= load()
    return pending
  }
}
