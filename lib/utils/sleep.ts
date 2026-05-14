/**
 * Async sleep — resolves after `ms` milliseconds. Suitable for request-path
 * code and any async control flow that already awaits.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Synchronous busy-wait sleep. Blocks the event loop, so reserve for
 * startup or off-request-path code where converting the caller to async
 * isn't worth the ripple.
 */
export function sleepSync(ms: number): void {
  const end = Date.now() + ms
  while (Date.now() < end) {
    // busy-wait
  }
}
