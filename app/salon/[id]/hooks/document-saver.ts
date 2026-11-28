/**
 * The per-document save machine behind Document Mode (`useDocumentMode`) and
 * the workspace's standalone document tab (`StandaloneDocumentView`).
 *
 * It holds the pane's live text and the text last written to the store, the
 * "absorb Lexical's first re-serialization" flag, the 30-second autosave
 * timer and the save in flight, and runs the one save loop both surfaces
 * share: one save per document at a time (a second call joins it); text typed
 * while a write is out is written by the same run before it resolves (#174);
 * a 409 re-reads the stored copy and leaves unsaved edits in the pane; a
 * refusal resolves `false` so a close or rename can refuse to go over it
 * (#175). The transport (which route, which body) and what the screen shows
 * are the caller's, through {@link DocumentSaverOptions}.
 *
 * Plain TypeScript, no React: a caller keeps one instance per open document.
 *
 * @module app/salon/[id]/hooks/document-saver
 */

import { documentEditorKind } from '../components/document-editor-kind'

/** How long a pane waits after the last keystroke before writing. */
export const AUTOSAVE_DEBOUNCE_MS = 30000

/**
 * Whether the first change after loading `content` is Lexical's normalised
 * re-serialization (adopted as the baseline) rather than an edit. Only the
 * Markdown editor re-serializes, and empty content has nothing to
 * re-serialize — a flag left waiting would swallow the first real edit as the
 * "saved" baseline, showing Saved without ever writing.
 */
export function absorbsFirstChange(filePath: string, content: string): boolean {
  return documentEditorKind(filePath, 0) === 'markdown' && content !== ''
}

/** What one write came back as. */
export type DocumentWriteOutcome<Saved> =
  | { kind: 'saved'; data: Saved }
  | { kind: 'conflict' }
  | { kind: 'refused'; status: number; body: string }

/** Read a `write-document` answer: 409 is a conflict, any other non-2xx a refusal. */
export async function documentWriteOutcome<Saved>(res: Response): Promise<DocumentWriteOutcome<Saved>> {
  if (res.status === 409) return { kind: 'conflict' }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { kind: 'refused', status: res.status, body }
  }
  return { kind: 'saved', data: (await res.json()) as Saved }
}

/**
 * The server's sentence for a refused write: the `error` (or `message`) of a
 * JSON body, else `fallback`. Never the raw body, which may be HTML or empty.
 */
export function refusalMessage(body: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (typeof record.error === 'string' && record.error) return record.error
      if (typeof record.message === 'string' && record.message) return record.message
    }
  } catch {
    // not JSON; fall through
  }
  return fallback
}

/** The stored copy as re-read after a conflict. */
export interface ReloadedDocument {
  content?: string
  mtime?: number
}

export interface DocumentSaverOptions<Doc extends { filePath: string; mtime?: number }, Saved extends { mtime?: number }> {
  /** Prefix for the save loop's log lines, e.g. `[DocumentMode]`. */
  logPrefix: string
  /** The document as it stands, or null when it is no longer open. Read once at the start of a save. */
  current: () => Doc | null
  /** Write `content`; `saved` is the text last written, for a diff. */
  write: (doc: Doc, args: { content: string; saved: string; mtime: number | undefined }) => Promise<DocumentWriteOutcome<Saved>>
  /** Re-read the stored copy after a conflict. Throw, or resolve null, when it cannot be read. */
  read: (doc: Doc) => Promise<ReloadedDocument | null>
  setSaving: (saving: boolean) => void
  /** A write landed. `stillDirty`: text typed since is still unwritten. */
  onSaved: (content: string, data: Saved, stillDirty: boolean) => void
  /** A conflict's re-read came back; `hadLocalEdits` says whether the pane held unwritten text. */
  onConflict: (doc: Doc, latest: ReloadedDocument, hadLocalEdits: boolean) => void
  /**
   * A write was refused (any non-409 error, `status` 0 when the request itself
   * failed). The edits are still only in the pane; show the user why.
   */
  onRefused?: (doc: Doc, refusal: { status: number; body: string }) => void
}

/** What a content change amounted to. */
export type DocumentChange = 'absorbed' | 'clean' | 'dirty'

/**
 * Where a pane's change came from. `'editor'` (the default) may be the rich
 * editor re-serializing what it was just given; `'source'` is text the user
 * typed into a raw surface (Markdown's Source view), which re-serializes
 * nothing and so is never absorbed (#307).
 */
export type DocumentChangeOrigin = 'editor' | 'source'

export class DocumentSaver<Doc extends { filePath: string; mtime?: number }, Saved extends { mtime?: number }> {
  private content = ''
  private saved = ''
  private absorbNext = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<boolean> | null = null

  private options: () => DocumentSaverOptions<Doc, Saved>

  /**
   * `options` is read at the moment of use, so its callbacks may change
   * between renders; or hand them over later with {@link configure}.
   */
  constructor(options?: () => DocumentSaverOptions<Doc, Saved>) {
    this.options = options ?? (() => {
      throw new Error('DocumentSaver used before it was configured')
    })
  }

  /** Replace the options (a component's latest callbacks). */
  configure(options: DocumentSaverOptions<Doc, Saved>): void {
    this.options = () => options
  }

  /** Adopt `content` as both the pane's text and the stored copy. */
  reset(content: string, absorbNext: boolean): void {
    this.content = content
    this.saved = content
    this.absorbNext = absorbNext
  }

  /** The text last written to the store (the diff and changed-line baseline). */
  get savedContent(): string {
    return this.saved
  }

  /** Whether the pane holds text that has not been written to the store. */
  hasUnsavedEdits(): boolean {
    return this.content !== this.saved
  }

  /** The pane's text changed. A real edit (re)starts the autosave. */
  change(content: string, origin: DocumentChangeOrigin = 'editor'): DocumentChange {
    this.content = content
    // Only the rich editor re-serializes on load; a raw-text change is always
    // the user's own, so the waiting flag is dropped rather than spent on it.
    if (origin === 'source') this.absorbNext = false
    if (this.absorbNext) {
      this.absorbNext = false
      this.saved = content
      return 'absorbed'
    }
    if (content === this.saved) return 'clean'
    this.cancelAutosave()
    this.timer = setTimeout(() => {
      void this.save()
    }, AUTOSAVE_DEBOUNCE_MS)
    return 'dirty'
  }

  cancelAutosave(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Write now if anything is unwritten (the pane lost focus). */
  flush(): void {
    this.cancelAutosave()
    if (this.hasUnsavedEdits()) void this.save()
  }

  /** Stop the autosave; the document is closing. */
  dispose(): void {
    this.cancelAutosave()
  }

  /**
   * Write the unsaved text. Resolves `true` when nothing unsaved remains,
   * `false` when a write was refused (a 409 or any error) and the edits are
   * still only in the pane.
   */
  save(): Promise<boolean> {
    if (this.inFlight) return this.inFlight
    const run = this.runSave()
    this.inFlight = run
    void run.finally(() => {
      if (this.inFlight === run) this.inFlight = null
    })
    return run
  }

  private async runSave(): Promise<boolean> {
    const options = this.options()
    const doc = options.current()
    if (!doc || !this.hasUnsavedEdits()) return true
    let mtime = doc.mtime

    options.setSaving(true)
    try {
      while (this.hasUnsavedEdits()) {
        const content = this.content
        const outcome = await options.write(doc, { content, saved: this.saved, mtime })

        if (outcome.kind === 'conflict') {
          // The file was written elsewhere (likely the LLM) while it was open.
          // Re-read the stored copy: with no pending edits the caller adopts
          // it; otherwise the unsaved text stays and only the mtime moves, so
          // the next save can succeed.
          const hadLocalEdits = this.hasUnsavedEdits()
          try {
            const latest = await options.read(doc)
            if (latest) options.onConflict(doc, latest, hadLocalEdits)
            console.warn(`${options.logPrefix} Document changed on disk during save; reloaded mtime`, {
              filePath: doc.filePath,
              hadLocalEdits,
            })
          } catch (reloadError) {
            console.warn(`${options.logPrefix} Failed to reload document after save conflict`, reloadError)
          }
          return !hadLocalEdits
        }

        if (outcome.kind === 'refused') {
          console.warn(`${options.logPrefix} Failed to save document`, { status: outcome.status, body: outcome.body })
          options.onRefused?.(doc, { status: outcome.status, body: outcome.body })
          return false
        }

        // Record what was sent as saved — not whatever the pane holds now.
        this.saved = content
        mtime = outcome.data.mtime
        options.onSaved(content, outcome.data, this.hasUnsavedEdits())
      }
      return true
    } catch (error) {
      console.error(`${options.logPrefix} Failed to save document`, error)
      options.onRefused?.(doc, { status: 0, body: '' })
      return false
    } finally {
      options.setSaving(false)
    }
  }
}
