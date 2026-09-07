'use client'

/**
 * SubpromptPicker — the "Subprompts" dropdown that sits under a character's
 * system-prompt selector (New Chat dialog, the Salon Participants drawer): a
 * disclosure button summarising how many are in play, expanding to a list of
 * checkboxes, one per subprompt in the character's vault, plus a "New
 * subprompt…" action that opens the editor dialog right there. A freshly
 * created subprompt is ticked on automatically.
 *
 * The list expands inline rather than floating, so it works the same inside
 * a scrolling sidebar as it does in a modal — nothing to clip or z-fight.
 *
 * Controlled: the caller owns `selectedIds` and hears every change through
 * `onChange` with the full next set.
 */

import { useId, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { SubpromptEditorModal } from './SubpromptEditorModal'
import { useCharacterSubprompts, type SubpromptRecord } from './useCharacterSubprompts'

export interface SubpromptPickerProps {
  characterId: string
  characterName?: string
  selectedIds: readonly string[]
  onChange: (nextIds: string[]) => void
  disabled?: boolean
  /** Compact styling for the sidebar card. */
  size?: 'sm' | 'md'
  /** Start expanded (the New Chat card, where there is room). */
  defaultOpen?: boolean
}

export function SubpromptPicker({
  characterId,
  characterName,
  selectedIds,
  onChange,
  disabled,
  size = 'md',
  defaultOpen = false,
}: SubpromptPickerProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [editorOpen, setEditorOpen] = useState(false)
  const listId = useId()
  const { subprompts, isLoading } = useCharacterSubprompts(characterId, { enabled: open || selectedIds.length > 0 })

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const known = useMemo(() => new Set(subprompts.map((s) => s.id)), [subprompts])
  const activeCount = subprompts.filter((s) => selected.has(s.id)).length

  const toggle = (id: string, on: boolean) => {
    if (on === selected.has(id)) return
    const next = on ? [...selectedIds, id] : selectedIds.filter((x) => x !== id)
    onChange(next)
  }

  const handleCreated = (saved: SubpromptRecord, mode: 'created' | 'updated') => {
    if (mode === 'created' && !selected.has(saved.id)) {
      onChange([...selectedIds, saved.id])
    }
  }

  const summary = subprompts.length === 0 && !isLoading
    ? 'None on file'
    : isLoading && subprompts.length === 0
      ? 'Loading…'
      : `${activeCount} of ${subprompts.length} in play`

  const small = size === 'sm'
  const buttonClass = small
    ? 'qt-select qt-select-sm w-full flex items-center justify-between gap-2 text-left'
    : 'w-full flex items-center justify-between gap-2 rounded-lg border qt-border-default bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-left'

  return (
    <div className="subprompt-picker">
      <button
        type="button"
        className={buttonClass}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listId}
        title="Subprompts in play for this chat"
      >
        <span className="truncate">
          <span className={small ? '' : 'font-medium'}>Subprompts</span>
          <span className="qt-text-secondary"> · {summary}</span>
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className="w-3.5 h-3.5 flex-shrink-0" />
      </button>

      {open && (
        <div
          id={listId}
          className={`mt-1 rounded-lg border qt-border-default qt-bg-card ${small ? 'p-1.5' : 'p-2'} space-y-1`}
        >
          {subprompts.length === 0 && !isLoading && (
            <p className="text-xs qt-text-secondary px-1 py-0.5">
              {characterName ?? 'This character'} has no subprompts yet.
            </p>
          )}
          {subprompts.map((s) => (
            <label
              key={s.id}
              className={`flex items-start gap-2 px-1 py-0.5 rounded cursor-pointer ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              title={s.content.slice(0, 200)}
            >
              <input
                type="checkbox"
                className="qt-checkbox mt-0.5"
                checked={selected.has(s.id)}
                onChange={(e) => toggle(s.id, e.target.checked)}
                disabled={disabled}
                aria-label={`Subprompt ${s.title}`}
              />
              <span className="text-sm text-foreground min-w-0 truncate">{s.title}</span>
            </label>
          ))}
          {/* Ids ticked on that no longer match a file — still shown so they can be unticked. */}
          {selectedIds.filter((id) => !known.has(id) && !isLoading).map((id) => (
            <label key={`missing-${id}`} className="flex items-start gap-2 px-1 py-0.5 rounded cursor-pointer" title="This subprompt no longer exists in the vault">
              <input
                type="checkbox"
                className="qt-checkbox mt-0.5"
                checked
                onChange={() => toggle(id, false)}
                disabled={disabled}
                aria-label={`Missing subprompt ${id}`}
              />
              <span className="text-sm qt-text-secondary line-through min-w-0 truncate">{id}</span>
            </label>
          ))}
          <button
            type="button"
            className="qt-button-ghost qt-button-sm w-full flex items-center justify-start gap-1.5 mt-1"
            onClick={() => setEditorOpen(true)}
            disabled={disabled}
          >
            <Icon name="plus" className="w-3.5 h-3.5" />
            New subprompt…
          </button>
        </div>
      )}

      <SubpromptEditorModal
        isOpen={editorOpen}
        characterId={characterId}
        characterName={characterName}
        onClose={() => setEditorOpen(false)}
        onSaved={handleCreated}
      />
    </div>
  )
}
