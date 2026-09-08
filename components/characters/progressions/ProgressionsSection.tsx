'use client'

/**
 * ProgressionsSection — a character's timed conditions, on the Aurora edit
 * page beside their subprompts.
 *
 * A progression is a named span of time the character is carrying: a
 * pregnancy, a recharging cannon, a fermentation. Every turn they take,
 * Quilltap works out how far along it is and tells them, on whatever cadence
 * the entry asks for.
 *
 * The live line under each row is rendered by the same client-safe engine the
 * server prompts with, at `Date.now()` — so what the author reads here is
 * exactly what the character will read, arithmetic and all. It ticks, because
 * a "42% complete" frozen beside an advancing recharge would be a worse lie
 * than no line at all.
 */

import { useEffect, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { apiErrorMessage } from '@/lib/query/fetcher'
import { deriveProgression, renderProgressionReport } from '@/lib/progressions/engine'
import {
  MAX_PROGRESSIONS_PER_CHARACTER,
  type Progression,
} from '@/lib/progressions/schema'

import { ProgressionEditorModal } from './ProgressionEditorModal'
import { useCharacterProgressions } from './useCharacterProgressions'

interface ProgressionsSectionProps {
  characterId: string
  characterName: string
}

const STATE_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: 'not yet begun', className: 'qt-badge qt-badge-info' },
  active: { label: 'in progress', className: 'qt-badge qt-badge-success' },
  complete: { label: 'complete', className: 'qt-badge qt-badge-warning' },
}

export function ProgressionsSection({ characterId, characterName }: Readonly<ProgressionsSectionProps>) {
  const { progressions, invalidIds, isArchived, isLoading, save, remove } =
    useCharacterProgressions(characterId)

  const [editing, setEditing] = useState<{ id: string; progression: Progression } | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // The clock the live lines read. Held in state and advanced by an interval:
  // reading `Date.now()` during render is impure, and React may re-render
  // whenever it likes.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const entries = Object.entries(progressions).sort(([a], [b]) => a.localeCompare(b))
  const atCeiling = entries.length >= MAX_PROGRESSIONS_PER_CHARACTER

  const handleSave = async (id: string, progression: Progression) => {
    try {
      await save.mutateAsync({
        ...progressions,
        // Stamped here so the character's very next turn reports the change
        // regardless of the entry's own cadence.
        [id]: { ...progression, updatedAt: new Date().toISOString() },
      })
      showSuccessToast(editing ? 'Progression updated' : 'Progression added')
      setEditing(null)
      setCreating(false)
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'The progression could not be saved.'))
    }
  }

  const handleDelete = async (id: string) => {
    const next = { ...progressions }
    delete next[id]
    try {
      await remove.mutateAsync(next)
      showSuccessToast('Progression removed')
    } catch (err) {
      showErrorToast(apiErrorMessage(err, 'The progression could not be removed.'))
    } finally {
      setDeleteConfirm(null)
    }
  }

  return (
    <div className="space-y-4 pt-6 border-t qt-border-default">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="qt-heading-4 text-foreground">Progressions</h3>
          <p className="qt-text-small">
            Spans of time {characterName} is carrying — a gestation, a recharging weapon, a fermentation. Each
            turn, Quilltap works out how far along it is and tells them so, without the model having to do
            arithmetic or remember that time has passed. They live in the vault&rsquo;s <code>metadata.json</code>,
            where a custom tool can read them and adjust them; the model itself never sets one.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={isArchived || atCeiling}
          title={
            isArchived
              ? 'An archived character is a tombstone — rehydrate them first.'
              : atCeiling
                ? `A character may carry at most ${MAX_PROGRESSIONS_PER_CHARACTER} progressions.`
                : undefined
          }
          className="qt-button-primary flex-shrink-0"
        >
          + Add Progression
        </button>
      </div>

      {isArchived && (
        <p className="qt-text-small qt-text-secondary">
          {characterName} is archived, so this card is read-only. Rehydrate them to make changes.
        </p>
      )}

      {invalidIds.length > 0 && (
        <p className="qt-text-small qt-text-destructive">
          {invalidIds.length === 1 ? 'One entry in' : `${invalidIds.length} entries in`} this
          character&rsquo;s <code>metadata.json</code> could not be read and {invalidIds.length === 1 ? 'is' : 'are'}{' '}
          being skipped: <code>{invalidIds.join('</code>, <code>')}</code>. Editing the file directly is the way to
          mend {invalidIds.length === 1 ? 'it' : 'them'}.
        </p>
      )}

      {isLoading ? (
        <div className="text-center py-4 qt-text-secondary">Loading progressions...</div>
      ) : entries.length === 0 ? (
        <div className="qt-card text-center">
          <p className="qt-text-small mb-4">
            Nothing in progress. Add one and {characterName} will be told where it stands, every turn it matters.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={isArchived}
            className="qt-button-primary"
          >
            Create First Progression
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(([id, progression]) => {
            const derived = deriveProgression(id, progression, nowMs)
            const badge = STATE_BADGE[derived.state]
            return (
              <div key={id} className="qt-card hover:bg-accent/50 transition">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="qt-text-primary truncate">{progression.name}</h4>
                      <code className="text-xs qt-text-secondary">{id}</code>
                      <span className={badge.className}>{badge.label}</span>
                    </div>
                    <p className="qt-text-small italic">
                      {renderProgressionReport(progression, derived)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    <button
                      type="button"
                      onClick={() => setEditing({ id, progression })}
                      disabled={isArchived}
                      className="qt-button-icon qt-button-ghost"
                      title="Edit"
                      aria-label={`Edit progression ${progression.name}`}
                    >
                      <Icon name="pencil" className="w-4 h-4" />
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(deleteConfirm === id ? null : id)}
                        disabled={isArchived}
                        className="qt-button-icon qt-button-ghost hover:qt-text-destructive"
                        title="Delete"
                        aria-label={`Delete progression ${progression.name}`}
                      >
                        <Icon name="trash" className="w-4 h-4" />
                      </button>
                      {deleteConfirm === id && (
                        <div className="absolute right-0 top-full mt-1 p-3 qt-bg-card border qt-border-default rounded-lg qt-shadow-lg z-10 min-w-[240px]">
                          <p className="text-sm text-foreground mb-2">
                            Remove this progression? Any tool addressing <code>{id}</code> stops finding it.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleDelete(id)}
                              disabled={remove.isPending}
                              className="qt-button-destructive qt-button-sm flex-1"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm(null)}
                              className="qt-button-secondary qt-button-sm flex-1"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <ProgressionEditorModal
          // Keyed on the entry, so opening a different one mounts a fresh
          // form rather than re-seating a half-typed one.
          key={editing?.id ?? '__new__'}
          editing={editing}
          existingIds={entries.map(([id]) => id)}
          saving={save.isPending}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
