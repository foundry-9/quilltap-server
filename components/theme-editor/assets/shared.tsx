'use client'

/**
 * Calliope's Atelier — pieces the asset sections share: the removal confirm,
 * the licence picker and the file chooser.
 *
 * @module components/theme-editor/assets/shared
 */

import { useId, useRef, useState, type ReactNode } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { NAMED_LICENCES, PROPRIETARY } from './model'

interface ConfirmRemoveDialogProps {
  /** What is being removed, or null when the dialog is shut. */
  subject: string | null
  title: string
  /** What happens, in words. */
  body: ReactNode
  confirmLabel?: string
  onConfirm: () => Promise<boolean>
  onClose: () => void
}

/** A removal confirm: an alertdialog (Spec F, Stage 1). */
export function ConfirmRemoveDialog({ subject, title, body, confirmLabel = 'Remove', onConfirm, onClose }: ConfirmRemoveDialogProps) {
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    try {
      if (await onConfirm()) onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <BaseModal
      isOpen={subject !== null}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={title}
      role="alertdialog"
      busy={busy}
      footer={
        <div className="flex gap-2 justify-end">
          <button type="button" className="qt-button qt-button-secondary" onClick={onClose} disabled={busy}>
            Keep it
          </button>
          <button type="button" className="qt-button qt-button-destructive" onClick={confirm} disabled={busy}>
            {busy ? 'Removing…' : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="qt-text-small space-y-2">{body}</div>
    </BaseModal>
  )
}

const OTHER = '__other__'

const isListed = (value: string) => value === PROPRIETARY || NAMED_LICENCES.some((l) => l.id === value)

interface LicencePickerProps {
  value: string
  onChange: (value: string) => void
  /** The label above the picker. */
  label?: string
}

/**
 * A font licence (Spec F decision 4): one of the named licences, another
 * SPDX identifier typed in full, or proprietary. The option shown follows
 * `value`, so a licence set from outside (read from a font) is shown too.
 */
export function LicencePicker({ value, onChange, label = 'Licence' }: LicencePickerProps) {
  const selectId = useId()
  const otherId = useId()
  // Only needed while "another licence" is chosen and nothing is typed yet.
  const [typingOther, setTypingOther] = useState(false)
  const shown = isListed(value) ? value : value !== '' || typingOther ? OTHER : ''
  return (
    <div className="space-y-2">
      <label htmlFor={selectId} className="qt-label">{label}</label>
      <select
        id={selectId}
        className="qt-select w-full"
        value={shown}
        onChange={(e) => {
          const next = e.target.value
          setTypingOther(next === OTHER)
          if (next === OTHER) onChange(isListed(value) ? '' : value)
          else onChange(next)
        }}
      >
        <option value="" disabled>
          Choose a licence…
        </option>
        {NAMED_LICENCES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label} ({l.id})
          </option>
        ))}
        <option value={OTHER}>Another licence (type its SPDX identifier)</option>
        <option value={PROPRIETARY}>Proprietary — not freely licensed</option>
      </select>
      {shown === OTHER && (
        <div>
          <label htmlFor={otherId} className="qt-label">SPDX identifier</label>
          <input
            id={otherId}
            className="qt-input w-full"
            value={value}
            maxLength={200}
            placeholder="e.g. GPL-3.0-or-later WITH Font-exception-2.0"
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
    </div>
  )
}

/** The note shown while any font is proprietary (Spec F decision 4). */
export function ProprietaryNote() {
  return (
    <p className="qt-alert-warning qt-text-small" role="note">
      A font marked proprietary travels with this theme only on your say-so. Whoever shares the theme answers for the
      right to share the font in it; Quilltap neither checks nor vouches.
    </p>
  )
}

interface FileChooserProps {
  label: string
  accept: string
  multiple?: boolean
  disabled?: boolean
  className?: string
  onFiles: (files: File[]) => void
}

/** A button that opens the file picker; the files chosen go to `onFiles`, and the input is cleared for the next choice. */
export function FileChooser({ label, accept, multiple, disabled, className = 'qt-button qt-button-secondary qt-button-sm', onFiles }: FileChooserProps) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    </>
  )
}
