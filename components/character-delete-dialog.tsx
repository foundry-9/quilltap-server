'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'

interface ExclusiveChat {
  id: string
  title: string
  messageCount: number
  lastMessageAt: string | null
}

interface CascadePreview {
  characterId: string
  characterName: string
  exclusiveChats: ExclusiveChat[]
  exclusiveCharacterImageCount: number
  exclusiveChatImageCount: number
  totalExclusiveImageCount: number
  memoryCount: number
}

interface CharacterDeleteDialogProps {
  characterId: string
  characterName: string
  onClose: () => void
  /**
   * Runs the delete. Return its promise: the dialog holds both buttons
   * disabled until it settles, so a second click cannot send a second
   * DELETE (#271).
   */
  onConfirm: (options: { cascadeChats: boolean; cascadeImages: boolean }) => void | Promise<void>
}

export function CharacterDeleteDialog({
  characterId,
  characterName,
  onClose,
  onConfirm,
}: CharacterDeleteDialogProps) {
  const [deleteChats, setDeleteChats] = useState(true)
  const [deleteImages, setDeleteImages] = useState(true)
  const [deleting, setDeleting] = useState(false)
  // The ref answers a second click that lands before the re-render disables
  // the button; the state drives the markup.
  const deletingRef = useRef(false)

  // Read fresh on every opening (no cache kept, no retry): it is the account
  // of what this delete would take, so it must be current.
  const previewQuery = useQuery({
    queryKey: queryKeys.characters.cascadePreview(characterId),
    queryFn: ({ signal }) =>
      apiFetch<CascadePreview>(`/api/v1/characters/${characterId}?action=cascade-preview`, { signal }),
    gcTime: 0,
    retry: false,
  })
  const loading = previewQuery.isPending
  const preview = previewQuery.data ?? null
  const error = previewQuery.error ? 'Failed to load preview' : null

  const hasExclusiveData = preview &&
    (preview.exclusiveChats.length > 0 || preview.totalExclusiveImageCount > 0 || preview.memoryCount > 0)

  // Cascade only what the preview showed and offered a choice over (#241).
  // When the preview failed, or showed nothing of a kind, the character goes
  // alone and its chats and images stay.
  const handleConfirm = async () => {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try {
      await onConfirm({
        cascadeChats: !!preview && preview.exclusiveChats.length > 0 && deleteChats,
        cascadeImages: !!preview && preview.totalExclusiveImageCount > 0 && deleteImages,
      })
    } finally {
      // On success the caller has usually unmounted the dialog; on failure
      // it stays open and the buttons come back.
      deletingRef.current = false
      setDeleting(false)
    }
  }

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      busy={deleting}
      role="alertdialog"
      headerless
      className="p-6"
      bodyClassName="overflow-y-auto"
    >
      <ModalTitle className="qt-dialog-title text-xl mb-4">
        Delete Character
      </ModalTitle>

      {loading ? (
        <div className="py-8 text-center qt-text-small">
          Loading...
        </div>
      ) : error ? (
        <>
          <div className="py-4 qt-text-destructive">
            {error}
          </div>
          <p className="qt-text-small mb-4">
            Deleting <strong className="qt-text">{characterName}</strong> now removes the character only; its chats and images are kept.
          </p>
        </>
      ) : (
        <>
          <p className="qt-text-small mb-4">
            Are you sure you want to delete <strong className="qt-text">{characterName}</strong>?
          </p>

          {hasExclusiveData && (
            <div className="qt-alert-warning mb-4">
              <p className="font-medium mb-3">
                This character has associated data:
              </p>

              {preview!.exclusiveChats.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm mb-2">
                    <strong>{preview!.exclusiveChats.length}</strong> exclusive chat{preview!.exclusiveChats.length !== 1 ? 's' : ''} (only with this character):
                  </p>
                  <ul className="text-sm opacity-80 ml-4 list-disc max-h-32 overflow-y-auto">
                    {preview!.exclusiveChats.map(chat => (
                      <li key={chat.id}>
                        {chat.title} ({chat.messageCount} message{chat.messageCount !== 1 ? 's' : ''})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview!.totalExclusiveImageCount > 0 && (
                <p className="text-sm">
                  <strong>{preview!.totalExclusiveImageCount}</strong> exclusive image{preview!.totalExclusiveImageCount !== 1 ? 's' : ''} (not used elsewhere)
                </p>
              )}

              {preview!.memoryCount > 0 && (
                <p className="text-sm">
                  <strong>{preview!.memoryCount}</strong> memor{preview!.memoryCount !== 1 ? 'ies' : 'y'} (will always be deleted)
                </p>
              )}
            </div>
          )}

          {hasExclusiveData && (
            <div className="space-y-3 mb-6">
              {preview!.exclusiveChats.length > 0 && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteChats}
                    onChange={(e) => setDeleteChats(e.target.checked)}
                    className="w-4 h-4 rounded qt-border-default qt-text-destructive focus:ring-destructive"
                  />
                  <span className="qt-text-secondary">
                    Delete exclusive chats
                  </span>
                </label>
              )}

              {preview!.totalExclusiveImageCount > 0 && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteImages}
                    onChange={(e) => setDeleteImages(e.target.checked)}
                    className="w-4 h-4 rounded qt-border-default qt-text-destructive focus:ring-destructive"
                  />
                  <span className="qt-text-secondary">
                    Delete exclusive images
                  </span>
                </label>
              )}
            </div>
          )}

          {!hasExclusiveData && (
            <p className="qt-text-small mb-4">
              This character has no exclusive chats or images that would be deleted.
            </p>
          )}
        </>
      )}

      <div className="flex gap-3 justify-end">
        <button
          onClick={onClose}
          disabled={deleting}
          className="qt-button qt-button-secondary"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleConfirm()}
          disabled={loading || deleting}
          aria-busy={deleting || undefined}
          className="qt-button qt-button-destructive"
        >
          Delete Character
        </button>
      </div>
    </BaseModal>
  )
}
