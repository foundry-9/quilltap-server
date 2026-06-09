'use client'

import { useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { UserControlledCharacter } from '../types'

interface ReverseUserDialogProps {
  /** User-controlled characters to choose from (already excludes the current character). */
  characters: UserControlledCharacter[]
  onClose: () => void
  onConfirm: (name: string) => void
}

/**
 * Picker for the reverse "{{user}} → name" action: the user chooses which
 * user-controlled character's name should replace every `{{user}}` token in
 * this character's prompts. Mount this only while open so the initial selection
 * reflects the current character list.
 */
export function ReverseUserDialog({ characters, onClose, onConfirm }: ReverseUserDialogProps) {
  const [selectedId, setSelectedId] = useState<string>(characters[0]?.id ?? '')

  const selected = characters.find((c) => c.id === selectedId) ?? characters[0]

  const handleConfirm = () => {
    if (selected) onConfirm(selected.name)
  }

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      title="Restore {{user}} to a name"
      maxWidth="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="qt-button-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selected}
            className="qt-button-primary"
          >
            Replace {'{{user}}'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="qt-text-small">
          Choose which user-controlled character&apos;s name should replace every{' '}
          <code className="rounded qt-bg-muted px-1 text-xs">{'{{user}}'}</code> token in this
          character&apos;s prompts.
        </p>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {characters.map((char) => (
            <option key={char.id} value={char.id}>
              {char.name}
              {char.title ? ` - ${char.title}` : ''}
            </option>
          ))}
        </select>
      </div>
    </BaseModal>
  )
}
