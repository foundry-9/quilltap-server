'use client'

import { useCallback, useMemo, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { FloatingDialog } from '@/components/ui/FloatingDialog'

type StaffId =
  | 'lantern'
  | 'aurora'
  | 'librarian'
  | 'concierge'
  | 'prospero'
  | 'host'
  | 'commonplaceBook'
  | 'ariel'

const STAFF_OPTIONS: { id: StaffId; label: string }[] = [
  { id: 'host', label: 'The Host' },
  { id: 'librarian', label: 'The Librarian' },
  { id: 'lantern', label: 'The Lantern' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'concierge', label: 'The Concierge' },
  { id: 'prospero', label: 'Prospero' },
  { id: 'commonplaceBook', label: 'The Commonplace Book' },
  { id: 'ariel', label: 'Ariel' },
]

interface CharacterCard {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string | null
}

interface InsertAnnouncementDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  /** Character IDs already present in the chat (filtered out of the off-scene picker). */
  participantCharacterIds: string[]
  onPosted?: () => void
}

type Mode = 'staff' | 'character' | 'custom'

export default function InsertAnnouncementDialog({
  isOpen,
  onClose,
  chatId,
  participantCharacterIds,
  onPosted,
}: InsertAnnouncementDialogProps) {
  const [mode, setMode] = useState<Mode>('staff')
  const [staffId, setStaffId] = useState<StaffId>('host')
  const [characterId, setCharacterId] = useState<string>('')
  const [customName, setCustomName] = useState('')
  const [content, setContent] = useState('')
  const [characters, setCharacters] = useState<CharacterCard[]>([])
  const [charsLoading, setCharsLoading] = useState(false)
  const [charSearch, setCharSearch] = useState('')
  const [isPosting, setIsPosting] = useState(false)

  // Note: state resets naturally on each open because the parent conditionally
  // renders this component (`{insertAnnouncementOpen && <... />}`), so each
  // open is a fresh mount and useState() initializers fire again. Returning
  // null from a component does not by itself unmount it.

  const loadCharactersIfNeeded = useCallback(() => {
    if (characters.length > 0 || charsLoading) return
    setCharsLoading(true)
    fetch('/api/v1/characters')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        const all: CharacterCard[] = data.characters || []
        setCharacters(all)
      })
      .catch((err) => {
        showErrorToast(`Failed to load characters: ${err.message}`)
      })
      .finally(() => setCharsLoading(false))
  }, [characters.length, charsLoading])

  const handleModeChange = (next: Mode) => {
    setMode(next)
    if (next === 'character') {
      loadCharactersIfNeeded()
    }
  }

  const offSceneCharacters = useMemo(() => {
    const presentSet = new Set(participantCharacterIds)
    return characters
      .filter((c) => !presentSet.has(c.id))
      .filter((c) =>
        charSearch.trim().length === 0
          ? true
          : c.name.toLowerCase().includes(charSearch.trim().toLowerCase()),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [characters, participantCharacterIds, charSearch])

  const canPost = (() => {
    if (isPosting) return false
    if (content.trim().length === 0) return false
    if (mode === 'staff') return Boolean(staffId)
    if (mode === 'character') return Boolean(characterId)
    if (mode === 'custom') return customName.trim().length > 0
    return false
  })()

  const handlePost = async () => {
    if (!canPost) return

    const sender =
      mode === 'staff'
        ? { kind: 'staff' as const, staffId }
        : mode === 'character'
          ? { kind: 'character' as const, characterId }
          : { kind: 'custom' as const, displayName: customName.trim() }

    setIsPosting(true)
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=announcement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentMarkdown: content.trim(),
          sender,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const message = err.message || err.error || `Failed (HTTP ${res.status})`
        showErrorToast(message)
        return
      }

      showSuccessToast('Announcement posted')
      onPosted?.()
      onClose()
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to post announcement'
      showErrorToast(msg)
    } finally {
      setIsPosting(false)
    }
  }

  return (
    <FloatingDialog
      isOpen={isOpen}
      onClose={isPosting ? () => {} : onClose}
      title="Insert Announcement"
      storageKey="quilltap:insert-announcement-geometry"
      initialGeometry={{ width: 640, height: 560 }}
      minWidth={420}
      minHeight={420}
    >
      <div className="flex flex-col h-full">
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Mode selector */}
          <div className="mb-4">
            <label className="block text-sm qt-text-primary mb-2">Sender</label>
            <div className="flex gap-2" role="tablist" aria-label="Announcement sender type">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'staff'}
                onClick={() => handleModeChange('staff')}
                className={`qt-button ${mode === 'staff' ? 'qt-button-primary' : 'qt-button-secondary'}`}
                disabled={isPosting}
              >
                Staff
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'character'}
                onClick={() => handleModeChange('character')}
                className={`qt-button ${mode === 'character' ? 'qt-button-primary' : 'qt-button-secondary'}`}
                disabled={isPosting}
              >
                Off-scene character
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'custom'}
                onClick={() => handleModeChange('custom')}
                className={`qt-button ${mode === 'custom' ? 'qt-button-primary' : 'qt-button-secondary'}`}
                disabled={isPosting}
              >
                Custom
              </button>
            </div>
          </div>

          {/* Sender picker */}
          <div className="mb-4">
            {mode === 'staff' && (
              <div>
                <label htmlFor="announce-staff" className="block text-sm qt-text-primary mb-2">
                  Staff member
                </label>
                <select
                  id="announce-staff"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value as StaffId)}
                  className="qt-input w-full"
                  disabled={isPosting}
                >
                  {STAFF_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {mode === 'character' && (
              <div>
                <label htmlFor="announce-character-search" className="block text-sm qt-text-primary mb-2">
                  Off-scene character
                </label>
                <input
                  id="announce-character-search"
                  type="text"
                  value={charSearch}
                  onChange={(e) => setCharSearch(e.target.value)}
                  placeholder="Search by name…"
                  className="qt-input w-full mb-2"
                  disabled={isPosting || charsLoading}
                />
                {charsLoading ? (
                  <div className="qt-text-secondary text-sm">Loading characters…</div>
                ) : offSceneCharacters.length === 0 ? (
                  <div className="qt-text-secondary text-sm">
                    No matching workspace characters are absent from this chat.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto qt-border-primary border rounded">
                    {offSceneCharacters.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCharacterId(c.id)}
                        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 ${
                          characterId === c.id ? 'qt-bg-primary/20' : 'hover:qt-bg-primary/10'
                        }`}
                        disabled={isPosting}
                      >
                        {c.avatarUrl ? (
                          <img
                            src={c.avatarUrl}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full qt-bg-secondary flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{c.name}</div>
                          {c.title && (
                            <div className="text-xs qt-text-secondary truncate">{c.title}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {mode === 'custom' && (
              <div>
                <label htmlFor="announce-custom-name" className="block text-sm qt-text-primary mb-2">
                  Display name
                </label>
                <input
                  id="announce-custom-name"
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. The Narrator, A Distant Voice"
                  className="qt-input w-full"
                  disabled={isPosting}
                />
                <div className="qt-text-xs mt-1">
                  The bubble shows this name beside a placeholder avatar.
                </div>
              </div>
            )}
          </div>

          {/* Body editor */}
          <div>
            <label className="block text-sm qt-text-primary mb-2">Announcement</label>
            <MarkdownLexicalEditor
              value={content}
              onChange={setContent}
              disabled={isPosting}
              namespace="InsertAnnouncementDialog"
              ariaLabel="Announcement body"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t qt-border-default px-4 py-3 flex items-center justify-end gap-3">
          <button onClick={onClose} className="qt-button qt-button-secondary" disabled={isPosting}>
            Cancel
          </button>
          <button
            onClick={handlePost}
            disabled={!canPost}
            className="qt-button qt-button-primary"
          >
            {isPosting ? 'Posting…' : 'Post Announcement'}
          </button>
        </div>
      </div>
    </FloatingDialog>
  )
}
