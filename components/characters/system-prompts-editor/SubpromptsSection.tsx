'use client'

/**
 * SubpromptsSection — the list of a character's subprompts on the Aurora
 * "System Prompts" tab, under the primary prompts. Create, edit, and delete
 * go through the shared `SubpromptEditorModal` / `useCharacterSubprompts`,
 * so this is the same editor the New Chat and Salon dropdowns summon.
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
  SubpromptEditorModal,
  useCharacterSubprompts,
  subpromptErrorMessage,
  type SubpromptRecord,
} from '@/components/subprompts'

interface SubpromptsSectionProps {
  characterId: string
  characterName: string
}

export function SubpromptsSection({ characterId, characterName }: SubpromptsSectionProps) {
  const { subprompts, isLoading, remove } = useCharacterSubprompts(characterId)
  const [editing, setEditing] = useState<SubpromptRecord | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id)
      showSuccessToast('Subprompt deleted')
    } catch (err) {
      showErrorToast(subpromptErrorMessage(err, 'Failed to delete subprompt'))
    } finally {
      setDeleteConfirm(null)
    }
  }

  return (
    <div className="space-y-4 pt-6 border-t qt-border-default">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="qt-heading-4 text-foreground">Subprompts</h3>
          <p className="qt-text-small">
            Smaller instructions {characterName} may carry into a particular chat. Each lives as a Markdown file in the vault&rsquo;s <code>Subprompts/</code> folder, and is switched on or off per conversation from the New Chat dialog or the Participants drawer. Write them to the character in the second person, as you would a system prompt.
          </p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="qt-button-primary flex-shrink-0">
          + Add Subprompt
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-4 qt-text-secondary">Loading subprompts...</div>
      ) : subprompts.length === 0 ? (
        <div className="qt-card text-center">
          <p className="qt-text-small mb-4">No subprompts yet. Add one to have it on offer when a chat begins.</p>
          <button type="button" onClick={() => setCreating(true)} className="qt-button-primary">
            Create First Subprompt
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {subprompts.map((s) => (
            <div key={s.id} className="qt-card hover:bg-accent/50 transition">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="qt-text-primary truncate">{s.title}</h4>
                    <span className="text-xs qt-text-secondary truncate" title={s.path}>{s.path}</span>
                  </div>
                  <p className="qt-text-small line-clamp-2">
                    {s.content.length > 150 ? `${s.content.slice(0, 150)}...` : s.content}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-4">
                  <button
                    type="button"
                    onClick={() => setEditing(s)}
                    className="qt-button-icon qt-button-ghost"
                    title="Edit"
                    aria-label={`Edit subprompt ${s.title}`}
                  >
                    <Icon name="pencil" className="w-4 h-4" />
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(deleteConfirm === s.id ? null : s.id)}
                      className="qt-button-icon qt-button-ghost hover:qt-text-destructive"
                      title="Delete"
                      aria-label={`Delete subprompt ${s.title}`}
                    >
                      <Icon name="trash" className="w-4 h-4" />
                    </button>
                    {deleteConfirm === s.id && (
                      <div className="absolute right-0 top-full mt-1 p-3 qt-bg-card border qt-border-default rounded-lg qt-shadow-lg z-10 min-w-[220px]">
                        <p className="text-sm text-foreground mb-2">
                          Delete this subprompt? Any chat with it in play drops it.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleDelete(s.id)}
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
          ))}
        </div>
      )}

      <SubpromptEditorModal
        isOpen={creating || editing !== null}
        characterId={characterId}
        characterName={characterName}
        editing={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />
    </div>
  )
}
