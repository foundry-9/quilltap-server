'use client'

/**
 * Calliope's Atelier — the new-theme dialog and the delete confirm.
 *
 * @module components/theme-editor/DraftDialogs
 */

import { useId, useState } from 'react'
import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { useTheme } from '@/components/providers/theme-provider'
import { useCreateThemeDraft, useDeleteThemeDraft, type DraftDetail } from './use-theme-drafts'

const BLANK = 'default'

interface NewDraftDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (draft: DraftDetail) => void
}

/** "New theme": a name and what to start from (blank or an installed theme). */
export function NewDraftDialog({ isOpen, onClose, onCreated }: NewDraftDialogProps) {
  const { availableThemes } = useTheme()
  const create = useCreateThemeDraft()
  const [name, setName] = useState('')
  const [from, setFrom] = useState(BLANK)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()
  const fromId = useId()
  const errorId = useId()

  const startable = availableThemes.filter((t) => t.source === 'bundle')
  const trimmed = name.trim()

  const close = () => {
    if (create.isPending) return
    setName('')
    setFrom(BLANK)
    setError(null)
    onClose()
  }

  const submit = async () => {
    if (!trimmed) {
      setError('A theme must be called something, however modest.')
      return
    }
    setError(null)
    try {
      const draft = await create.mutateAsync({ name: trimmed, from: from === BLANK ? undefined : from })
      setName('')
      setFrom(BLANK)
      onCreated(draft)
    } catch (err) {
      setError(apiErrorMessage(err, 'The atelier could not begin that theme.'))
    }
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={close}
      title="Commission a new theme"
      subtitle="Name it, and say whether to begin on a blank canvas or from a theme already in the wardrobe."
      busy={create.isPending}
      footer={
        <div className="flex gap-2 justify-end">
          <button type="button" className="qt-button qt-button-secondary" onClick={close} disabled={create.isPending}>
            Cancel
          </button>
          <button type="button" className="qt-button qt-button-primary" onClick={submit} disabled={create.isPending || !trimmed}>
            {create.isPending ? 'Preparing the canvas…' : 'Begin'}
          </button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div>
          <label htmlFor={nameId} className="qt-label">Name</label>
          <input
            id={nameId}
            className="qt-input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </div>
        <div>
          <label htmlFor={fromId} className="qt-label">Start from</label>
          <select id={fromId} className="qt-select w-full" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value={BLANK}>A blank canvas (the house default)</option>
            {startable.map((t) => (
              <option key={t.id} value={t.id}>A copy of {t.name}</option>
            ))}
          </select>
        </div>
        {error && (
          <p id={errorId} role="alert" className="qt-text-small qt-text-destructive">{error}</p>
        )}
      </form>
    </BaseModal>
  )
}

interface DeleteDraftDialogProps {
  draft: { id: string; name: string } | null
  onClose: () => void
  onDeleted: (id: string) => void
}

/** The delete confirm: an alertdialog, since a deleted draft is gone. */
export function DeleteDraftDialog({ draft, onClose, onDeleted }: DeleteDraftDialogProps) {
  const remove = useDeleteThemeDraft()
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (remove.isPending) return
    setError(null)
    onClose()
  }

  const confirm = async () => {
    if (!draft) return
    setError(null)
    try {
      await remove.mutateAsync(draft.id)
      onDeleted(draft.id)
    } catch (err) {
      setError(apiErrorMessage(err, 'The draft declined to be swept away.'))
    }
  }

  return (
    <BaseModal
      isOpen={draft !== null}
      onClose={close}
      role="alertdialog"
      headerless
      className="p-6"
      busy={remove.isPending}
    >
      <div className="space-y-3 mb-6">
        <ModalTitle className="qt-heading-4">Delete “{draft?.name}”?</ModalTitle>
        <p className="qt-text-small qt-text-secondary">
          The draft and every file in its folder go into the dustbin for good. An installed copy, if you made one, stays where it is.
        </p>
        {error && <p role="alert" className="qt-text-small qt-text-destructive">{error}</p>}
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" className="qt-button qt-button-secondary" onClick={close} disabled={remove.isPending}>
          Keep it
        </button>
        <button type="button" className="qt-button qt-button-destructive" onClick={confirm} disabled={remove.isPending}>
          {remove.isPending ? 'Sweeping…' : 'Delete the draft'}
        </button>
      </div>
    </BaseModal>
  )
}
