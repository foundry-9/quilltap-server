'use client'

/**
 * ConsoleContextBar
 *
 * Beneath the Console's header whenever Writing Assistant is on: a wrapping
 * row of chips, one per named source (each removable), a conversation's
 * character vaults as smaller derived chips beneath it, missing sources
 * struck through, and an "Add to context" button that opens
 * {@link ConsoleContextDialog}.
 *
 * @module components/brahma-console/ConsoleContextBar
 */

import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { IconName } from '@/components/ui/icons/icon-registry'
import { ConsoleContextDialog } from './ConsoleContextDialog'
import type { ContextChip } from './console-context-chips'
import type { PendingContextItem } from './hooks/useBrahmaConsoleSession'

const KIND_ICON: Record<ContextChip['ref']['kind'], IconName> = {
  chat: 'chat',
  project: 'projects',
  store: 'scriptorium',
  general: 'book',
}

const KIND_NAME: Record<ContextChip['ref']['kind'], string> = {
  chat: 'Conversation',
  project: 'Project',
  store: 'Document store',
  general: 'Quilltap General',
}

interface ConsoleContextBarProps {
  chips: ContextChip[]
  /** Edits are refused (a reply is streaming, a save is in flight). */
  disabled?: boolean
  onRemove: (chip: ContextChip) => void
  onAdd: (items: PendingContextItem[]) => void
}

export function ConsoleContextBar({ chips, disabled, onRemove, onAdd }: ConsoleContextBarProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const existingKeys = useMemo(() => new Set(chips.map(c => c.key)), [chips])

  return (
    <div className="qt-console-context-bar" aria-label="Sources for this piece" role="group">
      {chips.length === 0 && (
        <p className="text-xs qt-text-secondary">
          No sources named. The engine shall write from its own resources — or add a conversation, project or store for it to consult.
        </p>
      )}
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {chips.map(chip => (
            <li key={chip.key} className="flex flex-col gap-1">
              <span
                className={`qt-console-context-chip${chip.missing ? ' qt-console-context-chip-missing' : ''}`}
                title={chip.missing ? `${KIND_NAME[chip.ref.kind]} — no longer on the books` : KIND_NAME[chip.ref.kind]}
              >
                <Icon name={KIND_ICON[chip.ref.kind]} className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{chip.missing ? <s>{chip.label}</s> : chip.label}</span>
                <button
                  type="button"
                  onClick={() => onRemove(chip)}
                  disabled={disabled}
                  className="qt-console-context-chip-remove"
                  aria-label={`Remove ${chip.label} from the context`}
                >
                  <Icon name="close" className="w-3 h-3" />
                </button>
              </span>
              {chip.derived.length > 0 && (
                <ul className="flex flex-wrap gap-1 pl-3" aria-label={`Characters in ${chip.label}`}>
                  {chip.derived.map(d => (
                    <li key={d.key} className="qt-console-context-chip qt-console-context-chip-derived">
                      <Icon name="characters" className="w-3 h-3 shrink-0" />
                      <span className="truncate">{d.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <div>
        <button
          type="button"
          className="qt-button-secondary qt-button-sm"
          onClick={() => setDialogOpen(true)}
          disabled={disabled}
        >
          <Icon name="plus" className="w-3.5 h-3.5" /> Add to context
        </button>
      </div>
      <ConsoleContextDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        existingKeys={existingKeys}
        onAdd={onAdd}
      />
    </div>
  )
}
