'use client'

/**
 * SubpromptEditorModal — create or edit one subprompt in a dialog: a title,
 * a Markdown body in the Lexical editor, and the standing reminder that
 * subprompts are written to the character in the second person, exactly as
 * system prompts are.
 *
 * Owns its form state so any dropdown can summon it with nothing but a
 * character id; the caller learns of a successful save through `onSaved`
 * (and gets the saved record, so a picker can tick the new one on).
 */

import { useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { PromptFieldLabel } from '@/components/prompt-fields/PromptFieldLabel'
import { PROMPT_FIELD_HINTS } from '@/components/prompt-fields/field-hints'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
  useCharacterSubprompts,
  subpromptErrorMessage,
  type SubpromptRecord,
} from './useCharacterSubprompts'

export interface SubpromptEditorModalProps {
  isOpen: boolean
  characterId: string
  /** Shown in the dialog title so the author knows whose vault this lands in. */
  characterName?: string
  /** When set, the dialog edits this subprompt; otherwise it creates one. */
  editing?: SubpromptRecord | null
  onClose: () => void
  /** Fired after a successful create or update with the saved record. */
  onSaved?: (saved: SubpromptRecord, mode: 'created' | 'updated') => void
}

/**
 * The dialog is keyed on (open, editing id) so each opening mounts a fresh
 * form — seeded from `editing` for an edit, blank for a create — with no
 * effect needed to reset state.
 */
export function SubpromptEditorModal(props: SubpromptEditorModalProps) {
  if (!props.isOpen) return null
  return <SubpromptEditorForm key={props.editing?.id ?? 'new'} {...props} />
}

function SubpromptEditorForm({
  isOpen,
  characterId,
  characterName,
  editing,
  onClose,
  onSaved,
}: SubpromptEditorModalProps) {
  const { create, update } = useCharacterSubprompts(characterId, { enabled: false })
  const [title, setTitle] = useState(() => editing?.title ?? '')
  const [content, setContent] = useState(() => editing?.content ?? '')

  const saving = create.isPending || update.isPending
  const disabled = !title.trim() || !content.trim() || saving

  const handleSave = async () => {
    if (disabled) return
    try {
      if (editing) {
        const { subprompt } = await update.mutateAsync({ id: editing.id, title: title.trim(), content })
        showSuccessToast('Subprompt updated')
        onSaved?.(subprompt, 'updated')
      } else {
        const { subprompt } = await create.mutateAsync({ title: title.trim(), content })
        showSuccessToast('Subprompt created')
        onSaved?.(subprompt, 'created')
      }
      onClose()
    } catch (err) {
      showErrorToast(subpromptErrorMessage(err, editing ? 'Failed to update subprompt' : 'Failed to create subprompt'))
    }
  }

  const footer = (
    <div className="flex justify-end gap-3">
      <button type="button" onClick={onClose} className="qt-button-secondary" disabled={saving}>
        Cancel
      </button>
      <button type="button" onClick={handleSave} disabled={disabled} className="qt-button-primary">
        {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
      </button>
    </div>
  )

  const titleText = editing
    ? `Edit Subprompt${characterName ? ` — ${characterName}` : ''}`
    : `New Subprompt${characterName ? ` for ${characterName}` : ''}`

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={titleText}
      maxWidth="2xl"
      showCloseButton={true}
      footer={footer}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="subprompt-title" className="qt-label">
            Title <span className="qt-text-destructive">*</span>
          </label>
          <input
            id="subprompt-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Keep it brief, Speak in verse, No spoilers"
            className="qt-input"
            maxLength={100}
            disabled={saving}
          />
          {editing && (
            <p className="text-xs qt-text-secondary mt-1">
              Kept on file as <code>{editing.path}</code>. The file name stays put when the title changes, so chats that have this subprompt in play keep it.
            </p>
          )}
        </div>

        <div>
          <PromptFieldLabel
            hint={PROMPT_FIELD_HINTS.subprompt}
            label="Instruction"
            required
            helper={`${PROMPT_FIELD_HINTS.subprompt.helper} Markdown is supported, and {{char}} / {{user}} substitute the character and user names.`}
          />
          <MarkdownLexicalEditor
            value={content}
            onChange={setContent}
            remountKey={editing?.id ?? 'new'}
            namespace="SubpromptEditorModal.content"
            ariaLabel="Subprompt instruction"
            minHeight="10rem"
            disabled={saving}
          />
        </div>
      </div>
    </BaseModal>
  )
}
