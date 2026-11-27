'use client'

/**
 * The chrome around an open draft: the header's row of controls (back, the
 * save status, the mode, the preview, the gallery, the inspector, Calliope,
 * export and install) and the list of what the last save found, each issue
 * with its hand-off to Calliope.
 *
 * @module components/theme-editor/DraftHeader
 */

import { Icon } from '@/components/ui/icon'
import { OpenGalleryButton } from '@/components/theme-specimens/OpenGalleryButton'
import { InspectToggle } from '@/components/theme-inspect/InspectToggle'
import { CalliopeAvatar } from './calliope/CalliopeAvatar'
import { issueHandOffText } from './calliope/hand-off'
import type { EditorMode } from './model'
import type { DraftDetail, DraftExportForm } from './use-theme-drafts'

interface DraftHeaderProps {
  onBack: () => void
  saving: boolean
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  previewing: boolean
  onTogglePreview: () => void
  calliopeOpen: boolean
  onToggleCalliope: () => void
  /** The export under way, if any. */
  exporting: DraftExportForm | null
  onExport: (form: DraftExportForm) => void
  installing: boolean
  onInstall: () => void
  /** The id of the error list, while the draft has errors (export and install wait on them). */
  errorsId: string | null
}

export function DraftHeader({
  onBack,
  saving,
  mode,
  onModeChange,
  previewing,
  onTogglePreview,
  calliopeOpen,
  onToggleCalliope,
  exporting,
  onExport,
  installing,
  onInstall,
  errorsId,
}: Readonly<DraftHeaderProps>) {
  const blocked = errorsId !== null
  const describedBy = errorsId ?? undefined
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={onBack}>
        <Icon name="arrow-left" className="w-4 h-4" />
        <span className="ml-1">All drafts</span>
      </button>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="qt-text-xs qt-text-muted" aria-live="polite">
          {saving ? 'Saving…' : 'All changes saved'}
        </span>
        <div role="group" aria-label="Mode to edit and show in this tab" className="flex">
          {(['light', 'dark'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              className={`qt-button qt-button-sm ${mode === m ? 'qt-button-primary' : 'qt-button-secondary'}`}
              onClick={() => onModeChange(m)}
            >
              <Icon name={m === 'light' ? 'sun' : 'moon'} className="w-4 h-4" />
              <span className="ml-1">{m === 'light' ? 'Light' : 'Dark'}</span>
            </button>
          ))}
        </div>
        <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={onTogglePreview}>
          <Icon name={previewing ? 'eye-off' : 'eye'} className="w-4 h-4" />
          <span className="ml-1">{previewing ? 'Stop preview' : 'Resume preview'}</span>
        </button>
        <OpenGalleryButton />
        <InspectToggle />
        <button
          type="button"
          aria-pressed={calliopeOpen}
          className={`qt-button qt-button-sm ${calliopeOpen ? 'qt-button-primary' : 'qt-button-secondary'}`}
          onClick={onToggleCalliope}
        >
          <CalliopeAvatar className="w-5 h-5" />
          <span className="ml-1">Calliope</span>
        </button>
        <button
          type="button"
          className="qt-button qt-button-secondary qt-button-sm"
          onClick={() => onExport('draft')}
          disabled={exporting !== null || blocked}
          aria-describedby={describedBy}
          title="Save this draft as a .qtap-theme file, originals and all, to open again in an Atelier"
        >
          <Icon name="download" className="w-4 h-4" />
          <span className="ml-1">{exporting === 'draft' ? 'Exporting…' : 'Export draft'}</span>
        </button>
        <button
          type="button"
          className="qt-button qt-button-secondary qt-button-sm"
          onClick={() => onExport('theme')}
          disabled={exporting !== null || blocked}
          aria-describedby={describedBy}
          title="Save the finished theme as a .qtap-theme file: WebP pictures, WOFF2 fonts, nothing unused"
        >
          <Icon name="download" className="w-4 h-4" />
          <span className="ml-1">{exporting === 'theme' ? 'Exporting…' : 'Export theme'}</span>
        </button>
        <button
          type="button"
          className="qt-button qt-button-primary qt-button-sm"
          onClick={onInstall}
          disabled={installing || blocked}
          aria-describedby={describedBy}
        >
          <Icon name="download" className="w-4 h-4" />
          <span className="ml-1">{installing ? 'Installing…' : 'Install'}</span>
        </button>
      </div>
    </div>
  )
}

type DraftIssue = DraftDetail['issues'][number]

/** The last save's issues of one severity, each with "Ask Calliope". */
export function DraftIssueList({
  issues,
  onAsk,
  className,
  itemClassName,
}: Readonly<{ issues: readonly DraftIssue[]; onAsk: (text: string) => void; className: string; itemClassName?: string }>) {
  return (
    <ul className={className}>
      {issues.map((issue, i) => (
        <li key={i} className={itemClassName}>
          {issue.message}{' '}
          <button type="button" className="qt-inline-link qt-text-xs" onClick={() => onAsk(issueHandOffText(issue))}>
            Ask Calliope
          </button>
        </li>
      ))}
    </ul>
  )
}
