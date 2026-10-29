/**
 * Serializes diagram renders.
 *
 * `mermaid.render` (and the re-`initialize` that precedes each one) works on
 * shared global state: two renders in flight at once — a chat with several
 * diagrams scrolling into view together — is a known source of garbled output.
 * Every engine render therefore runs through this one queue, one at a time.
 * A failed task never jams the queue for the tasks behind it.
 */

let tail: Promise<unknown> = Promise.resolve()
let renderSerial = 0

export function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task)
  tail = run.catch(() => undefined)
  return run
}

/** A DOM-safe id that is unique for the life of the page. */
export function nextRenderId(prefix: string): string {
  renderSerial += 1
  return `${prefix}-${Date.now().toString(36)}-${renderSerial}`
}

/**
 * A stable 31-bit seed from the diagram source (FNV-1a). Hand-drawn renders
 * are seeded with it so a diagram keeps the same wobble every time its row
 * re-mounts, while two different diagrams still wobble differently.
 */
export function seedFromSource(source: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // Rough.js and Mermaid both treat 0 as "random", so never return it.
  return (hash >>> 1) || 1
}
