'use client'

/**
 * Group Members Card
 *
 * Expandable card displaying members in this group.
 * Users can add/remove members.
 */

import { useState } from 'react'
import { ChevronIcon } from '@/components/ui/ChevronIcon'
import type { GroupMember } from '../../types'

interface GroupMembersCardProps {
  members: GroupMember[]
  allCharacters: GroupMember[]
  expanded: boolean
  onToggle: () => void
  onAdd: (characterId: string) => Promise<boolean>
  onRemove: (characterId: string) => Promise<boolean>
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 8.048M12 4.354v8.048m-6.598-4.024A2 2 0 105.5 8.354m3.902-3.024A2 2 0 1110.5 8.354m6.598 4.024A2 2 0 1018.5 12.378m-3.902-3.024A2 2 0 1114.5 12.378" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

export function GroupMembersCard({
  members,
  allCharacters,
  expanded,
  onToggle,
  onAdd,
  onRemove,
}: GroupMembersCardProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const memberIds = new Set(members.map((m) => m.id))
  const availableCharacters = allCharacters.filter((c) => !memberIds.has(c.id))

  const handleAdd = async () => {
    if (!selectedCharacterId) return

    setAdding(true)
    try {
      const success = await onAdd(selectedCharacterId)
      if (success) {
        setShowPicker(false)
        setSelectedCharacterId(null)
      }
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (characterId: string) => {
    setRemoving(characterId)
    try {
      await onRemove(characterId)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <UsersIcon className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Members</h3>
            <p className="qt-text-small qt-text-secondary">
              {members.length} member{members.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content - expandable */}
      {expanded && (
        <div className="border-t qt-border-default">
          {members.length === 0 ? (
            <div className="p-4 text-center qt-text-secondary">
              <p>No members yet.</p>
              <p className="qt-text-small mt-1">
                Add characters to this group.
              </p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto p-2 space-y-1">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:qt-bg-muted transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="qt-label truncate">{member.name}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(member.id)}
                    disabled={removing === member.id}
                    className="ml-2 flex-shrink-0 p-1.5 rounded hover:qt-text-destructive transition-colors disabled:opacity-50"
                    title="Remove member"
                  >
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons or picker */}
          <div className="p-2 border-t qt-border-default">
            {!showPicker ? (
              <button
                onClick={() => setShowPicker(true)}
                disabled={availableCharacters.length === 0}
                className="w-full qt-button qt-button-primary text-sm"
                title={availableCharacters.length === 0 ? 'All characters are already members' : ''}
              >
                Add Member
              </button>
            ) : (
              <div className="space-y-2">
                <select
                  value={selectedCharacterId || ''}
                  onChange={(e) => setSelectedCharacterId(e.target.value || null)}
                  className="w-full px-3 py-2 rounded border qt-border-default bg-transparent text-foreground text-sm"
                >
                  <option value="">Select a character...</option>
                  {availableCharacters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={handleAdd}
                    disabled={!selectedCharacterId || adding}
                    className="flex-1 qt-button qt-button-primary text-sm"
                  >
                    {adding ? 'Adding...' : 'Add'}
                  </button>
                  <button
                    onClick={() => {
                      setShowPicker(false)
                      setSelectedCharacterId(null)
                    }}
                    className="flex-1 qt-button qt-button-secondary text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
