/**
 * Per-field autosave, as a framework-free engine.
 *
 * The one character page saves every control itself (design of record:
 * `docs/developer/features/complete/aurora-character-page-unification.md` §4).
 * This engine is the queue behind that rule:
 *
 * - **Drafts are per field.** `setDraft(key, value)` records what the user has
 *   on screen. A prose field passes `{ idle: true }` and is sent after
 *   `idleMs` without a keystroke; a short field waits for `commit(key)` (blur,
 *   Enter). `flush()` sends everything now (tab hide, unload, a generator
 *   about to write).
 * - **Coalescing.** Every flush sends every pending draft in one `save(patch)`,
 *   so two fields dirtied inside one window travel together.
 * - **One request in flight.** A flush asked for while one is out waits for
 *   it, then sends whatever is still pending — never two overlapping writes.
 * - **Failure keeps the text.** A failed save leaves its drafts in place,
 *   marks them failed, and reports the first one's label; `retry()` resends.
 *   Nothing is reverted.
 * - **Immediate controls** (selects, toggles, stars) save through
 *   `runImmediate`, which only counts them into the shared status; their
 *   optimistic update and revert belong to the caller.
 *
 * Pure: no React, no DOM, timers injectable — unit-tested with fake timers.
 *
 * @module lib/autosave/autosave-engine
 */

export type AutosaveStatus =
  | { state: 'saved' }
  | { state: 'editing' }
  | { state: 'saving' }
  | { state: 'error'; label: string }

export interface AutosaveSaveOptions {
  /** True on page unload: the request must survive the page (`fetch` keepalive). */
  keepalive: boolean
}

export interface AutosaveEngineOptions {
  /** Persist a coalesced patch. Throw (or reject) on failure. */
  save: (patch: Record<string, unknown>, opts: AutosaveSaveOptions) => Promise<void>
  /** Idle delay before a prose draft is sent. Default 1500 ms. */
  idleMs?: number
  /** Coalescing delay after a commit. Default 50 ms. */
  commitDelayMs?: number
  /** Human labels for fields, for the "Could not save X" status. */
  labelFor?: (key: string) => string
  /**
   * A draft that fails validation is held back (not sent) and reported by
   * `invalidReason(key)`. Return `null` when the value may be sent.
   */
  validate?: (key: string, value: unknown) => string | null
  /** Override for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

interface Draft {
  value: unknown
  /** Bumped on every setDraft, so a save only clears the value it sent. */
  version: number
}

export class AutosaveEngine {
  private readonly drafts = new Map<string, Draft>()
  private readonly failed = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private timer: unknown = null
  private inFlight: Promise<void> | null = null
  private again = false
  private immediates = 0
  private lastFailedKey: string | null = null
  private snapshot: AutosaveStatus = { state: 'saved' }
  private readonly idleMs: number
  private readonly commitDelayMs: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly options: AutosaveEngineOptions) {
    this.idleMs = options.idleMs ?? 1500
    this.commitDelayMs = options.commitDelayMs ?? 50
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  // ---------------------------------------------------------------- reading

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Stable between changes, for `useSyncExternalStore`. */
  getStatus = (): AutosaveStatus => this.snapshot

  hasDraft(key: string): boolean {
    return this.drafts.has(key)
  }

  draftOf(key: string): unknown {
    return this.drafts.get(key)?.value
  }

  hasFailed(key: string): boolean {
    return this.failed.has(key)
  }

  invalidReason(key: string): string | null {
    const draft = this.drafts.get(key)
    if (!draft || !this.options.validate) return null
    return this.options.validate(key, draft.value)
  }

  hasPending(): boolean {
    return this.drafts.size > 0
  }

  // ---------------------------------------------------------------- writing

  /** Record what the user has on screen. `idle` schedules a send after the idle delay. */
  setDraft(key: string, value: unknown, opts: { idle?: boolean } = {}): void {
    const prev = this.drafts.get(key)
    this.drafts.set(key, { value, version: (prev?.version ?? 0) + 1 })
    this.failed.delete(key)
    if (opts.idle) this.schedule(this.idleMs)
    this.emit()
  }

  /** Forget a draft without sending it (the value went back to what is stored). */
  discard(key: string): void {
    if (!this.drafts.delete(key)) return
    this.failed.delete(key)
    this.emit()
  }

  /** The user is done with a field (blur, Enter): send soon, coalescing. */
  commit(): void {
    if (this.drafts.size === 0) return
    this.schedule(this.commitDelayMs)
  }

  /** Send every pending draft now. Resolves when nothing this call sent is in flight. */
  flush(opts: AutosaveSaveOptions = { keepalive: false }): Promise<void> {
    this.cancelTimer()
    if (this.inFlight) {
      this.again = true
      return this.inFlight
    }
    const sendable = [...this.drafts.entries()].filter(
      ([key, draft]) => !this.options.validate || this.options.validate(key, draft.value) === null,
    )
    if (sendable.length === 0) {
      this.emit()
      return Promise.resolve()
    }

    const sent = new Map(sendable.map(([key, draft]) => [key, draft.version]))
    const patch = Object.fromEntries(sendable.map(([key, draft]) => [key, draft.value]))

    this.inFlight = (async () => {
      try {
        await this.options.save(patch, opts)
        for (const [key, version] of sent) {
          // Only clear what was sent; a keystroke during the round trip stays.
          if (this.drafts.get(key)?.version === version) this.drafts.delete(key)
          this.failed.delete(key)
        }
        if (this.failed.size === 0) this.lastFailedKey = null
      } catch {
        for (const key of sent.keys()) {
          if (this.drafts.has(key)) this.failed.add(key)
        }
        this.lastFailedKey = [...sent.keys()][0] ?? null
      } finally {
        this.inFlight = null
      }
      if (this.again) {
        this.again = false
        await this.flush(opts)
      }
    })()
    this.emit()
    // The status re-derives once the request settles.
    void this.inFlight.then(() => this.emit())
    return this.inFlight
  }

  /** Resend everything that failed (and anything else pending). */
  retry(): Promise<void> {
    return this.flush()
  }

  /**
   * Count an immediate control's save into the shared status. The caller owns
   * its optimistic update, its revert and its toast; this only says "Saving…"
   * while it runs. Re-throws, so the caller's `catch` still sees the failure.
   */
  async runImmediate<T>(fn: () => Promise<T>): Promise<T> {
    this.immediates++
    this.emit()
    try {
      return await fn()
    } finally {
      this.immediates--
      this.emit()
    }
  }

  /** Stop timers. Pending drafts are kept; call `flush()` first to send them. */
  dispose(): void {
    this.cancelTimer()
    this.listeners.clear()
  }

  // ---------------------------------------------------------------- internals

  private schedule(ms: number): void {
    this.cancelTimer()
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.flush()
    }, ms)
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }

  private deriveStatus(): AutosaveStatus {
    if (this.inFlight || this.immediates > 0) return { state: 'saving' }
    if (this.failed.size > 0) {
      const key = this.lastFailedKey && this.failed.has(this.lastFailedKey)
        ? this.lastFailedKey
        : [...this.failed][0]
      return { state: 'error', label: this.options.labelFor?.(key) ?? key }
    }
    if (this.drafts.size > 0) return this.timer !== null ? { state: 'saving' } : { state: 'editing' }
    return { state: 'saved' }
  }

  private emit(): void {
    const next = this.deriveStatus()
    const prev = this.snapshot
    const same =
      prev.state === next.state &&
      (prev.state !== 'error' || (next.state === 'error' && prev.label === next.label))
    if (!same) this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
