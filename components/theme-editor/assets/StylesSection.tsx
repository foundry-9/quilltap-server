'use client'

/**
 * Calliope's Atelier — the Custom CSS section (Calliope Live, Spec G, Stage 2).
 *
 * The draft's stylesheet in the shared code editor, the rules stated once,
 * the engine's errors and warnings on their lines, and the reference panel
 * beside it. The section holds no save logic of its own: the editor's text
 * goes up through `onChange` to the draft editor, which saves it with the
 * tokens' queue and revision handling and previews the scoped CSS the save
 * returns (decision 1). `flushRef` is how the draft editor gets a pending
 * edit out of the code editor before any other operation; the section also
 * flushes on its way out, so closing it loses nothing.
 *
 * @module components/theme-editor/assets/StylesSection
 */

import { useId, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { CodeEditor, type CodeEditorHandle } from '@/components/code-editor'
import type { ResolvedTheme, ThemeTokensDocument } from '@/lib/themes/engine/client'
import { themeDraftAction, type DraftDetail } from '../use-theme-drafts'
import type { EditorMode } from '../model'
import { useDraftOperations } from './use-draft-operations'
import { ConfirmRemoveDialog } from './shared'
import { StylesReference } from './StylesReference'
import { stylesheetHasErrors, stylesheetIssues, stylesheetMarkers } from './styles-model'

/** Where the stylesheet's save stands, as the draft editor sees it. */
export type StylesStatus = 'saved' | 'unsaved' | 'saving' | 'conflict'

const STATUS_TEXT: Record<StylesStatus, string> = {
  saved: 'Saved',
  unsaved: 'Waiting to be saved',
  saving: 'Saving…',
  conflict: 'Changed elsewhere — the newer version is before you',
}

/** Quiet before the editor hands its text up; the draft editor's queue adds its own pause. */
const EMIT_DELAY_MS = 300

interface StylesSectionProps {
  detail: DraftDetail
  /** The stylesheet as edited (the draft editor's copy). */
  value: string
  onChange: (css: string) => void
  status: StylesStatus
  /** Set to the code editor's flush while the section is open. */
  flushRef: MutableRefObject<(() => void) | null>
  tokens: ThemeTokensDocument
  resolved: ResolvedTheme
  mode: EditorMode
  /** Set, while there is a stylesheet to write in, to insert text at its cursor (the inspector's "Write CSS for this"). */
  insertRef?: MutableRefObject<((text: string) => void) | null>
}

function Rules() {
  return (
    <ul className="qt-text-xs qt-text-secondary list-disc pl-5 space-y-0.5">
      <li>Every rule is fitted to this theme alone, automatically; nothing you write reaches another.</li>
      <li>Keyframe names are made unique, so an animation never collides with the house&rsquo;s own.</li>
      <li>
        <code>@import</code> and <code>@font-face</code> are not admitted; fonts go in the Fonts section.
      </li>
      <li>
        A <code>url()</code> must name one of this draft&rsquo;s images.
      </li>
    </ul>
  )
}

export function StylesSection({ detail, value, onChange, status, flushRef, tokens, resolved, mode, insertRef }: StylesSectionProps) {
  const ops = useDraftOperations()
  const editorRef = useRef<CodeEditorHandle>(null)
  const [removing, setRemoving] = useState(false)
  const [deleteFile, setDeleteFile] = useState(true)
  const headingId = useId()
  const deleteId = useId()
  const styles = detail.styles
  const hasStyles = styles !== undefined && styles !== null

  // While open, the draft editor's flush reaches the code editor; on the way out, hand up what is pending.
  useLayoutEffect(() => {
    const editor = editorRef.current
    flushRef.current = () => editor?.flush()
    return () => {
      editor?.flush()
      flushRef.current = null
    }
  }, [flushRef, styles?.path])

  useLayoutEffect(() => {
    if (!insertRef || !hasStyles) return
    insertRef.current = (text) => editorRef.current?.insertAtCursor(text)
    return () => {
      insertRef.current = null
    }
  }, [insertRef, hasStyles])

  const issues = useMemo(() => (styles ? stylesheetIssues(detail.issues, styles.path) : []), [detail.issues, styles])
  const markers = useMemo(() => (styles ? stylesheetMarkers(detail.issues, styles.path) : []), [detail.issues, styles])
  const hasErrors = styles ? stylesheetHasErrors(detail.issues, styles.path) : false

  const create = async () => {
    await ops.run((manifestRevision, id) => themeDraftAction<{ draft: DraftDetail; path: string; created: boolean }>(id, 'set-styles-file', { manifestRevision }))
  }

  const remove = async () => {
    const result = await ops.run((manifestRevision, id) =>
      themeDraftAction<{ draft: DraftDetail; deleted: string[] }>(id, 'clear-styles-file', { manifestRevision, deleteFile }),
    )
    return result.ok
  }

  if (!styles) {
    return (
      <div className="px-4 pb-4 space-y-3">
        <p className="qt-text-small">
          Tokens dress most of a theme. What they cannot say — a textured panel, a heading with its letters spaced just so, a
          lamp that flickers — is written as CSS of your own, and this is where it lives.
        </p>
        <Rules />
        <button type="button" className="qt-button qt-button-primary qt-button-sm" onClick={create} disabled={ops.busy}>
          Begin a stylesheet
        </button>
      </div>
    )
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length

  return (
    <div className="px-4 pb-4 space-y-3">
      <Rules />
      {/* Side by side only when the section itself is wide enough: the Atelier often sits in a narrow pane. */}
      <div className="@container">
      <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_18rem] items-start">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 id={headingId} className="qt-text-small font-medium">
              <span className="font-mono">{styles.path}</span>
            </h4>
            <span className="qt-text-xs qt-text-muted" aria-live="polite">
              {STATUS_TEXT[status]}
            </span>
          </div>
          <CodeEditor
            ref={editorRef}
            value={value}
            language="css"
            onChange={onChange}
            markers={markers}
            ariaLabelledBy={headingId}
            debounceMs={EMIT_DELAY_MS}
            minHeight="16rem"
            maxHeight="70vh"
          />
          {hasErrors && (
            <p className="qt-alert-warning qt-text-small" role="status">
              The preview goes on wearing the last stylesheet that compiled until {errorCount === 1 ? 'this is' : 'these are'} mended.
            </p>
          )}
          {issues.length > 0 && (
            <ul className="space-y-1" aria-label="Problems in the stylesheet">
              {issues.map((issue, i) => (
                <li key={i} className={`qt-text-xs ${issue.severity === 'error' ? 'qt-text-destructive' : 'qt-text-warning'}`}>
                  {typeof issue.line === 'number' ? (
                    <button type="button" className="underline mr-1" onClick={() => editorRef.current?.revealLine(issue.line as number)}>
                      Line {issue.line}
                    </button>
                  ) : null}
                  {issue.severity === 'error' ? 'Error: ' : 'Warning: '}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={() => setRemoving(true)} disabled={ops.busy}>
            Remove the stylesheet
          </button>
        </div>
        <StylesReference
          tokens={tokens}
          resolved={resolved}
          mode={mode}
          images={detail.images}
          onInsert={(text) => editorRef.current?.insertAtCursor(text)}
        />
      </div>
      </div>

      <ConfirmRemoveDialog
        subject={removing ? styles.path : null}
        title="Remove the stylesheet?"
        confirmLabel="Remove it"
        onConfirm={remove}
        onClose={() => setRemoving(false)}
        body={
          <>
            <p>The theme stops wearing its custom CSS; the tokens are untouched.</p>
            <label htmlFor={deleteId} className="flex items-center gap-2">
              <input id={deleteId} type="checkbox" checked={deleteFile} onChange={(e) => setDeleteFile(e.target.checked)} />
              <span>
                Throw away <span className="font-mono">{styles.path}</span> as well
              </span>
            </label>
            {!deleteFile && <p className="qt-text-secondary">The file stays in the draft, where a later stylesheet can take it up again.</p>}
          </>
        }
      />
    </div>
  )
}
