'use client'

/**
 * SaveImageDialog — operator-facing "save this attached image" picker.
 *
 * Opens from the per-message Save Image toolbar button. Fetches the list
 * of candidate photo albums for the chat (chat participants' vaults, the
 * project album, linked document stores, Quilltap General), then POSTs
 * the chosen target to the save-image action on the message route.
 *
 * Mirrors the LLM `keep_image` save path under the hood — see
 * `lib/photos/save-image-to-album.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'
import type { MessageAttachment } from '../types'

type AlbumKind = 'character' | 'project' | 'document-store' | 'general'

interface AlbumOption {
  mountPointId: string
  name: string
  kind: AlbumKind
  characterId?: string
  participantId?: string
  isUserCharacter?: boolean
  isDefault?: boolean
}

interface SaveImageDialogProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  messageId: string
  /** All image attachments on the message. The dialog picks the first by default. */
  attachments: MessageAttachment[]
  /** Pre-selected attachment id (from the toolbar click). When omitted, first image is used. */
  initialAttachmentId?: string | null
  onSaved?: (info: { mountPoint: string; relativePath: string }) => void
}

const ALBUM_KIND_LABEL: Record<AlbumKind, string> = {
  character: 'Character',
  project: 'Project',
  'document-store': 'Document Store',
  general: 'Quilltap General',
}

export function SaveImageDialog({
  isOpen,
  onClose,
  chatId,
  messageId,
  attachments,
  initialAttachmentId,
  onSaved,
}: Readonly<SaveImageDialogProps>) {
  const imageAttachments = useMemo(
    () => attachments.filter(a => a.mimeType.startsWith('image/')),
    [attachments]
  )

  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string>(() =>
    initialAttachmentId ?? imageAttachments[0]?.id ?? ''
  )
  const [albums, setAlbums] = useState<AlbumOption[] | null>(null)
  const [selectedMountPointId, setSelectedMountPointId] = useState<string>('')
  const [caption, setCaption] = useState('')
  // The dialog is mounted fresh each open by the parent (it conditionally
  // renders only when there's a save target), so `loadingAlbums` can start
  // true — the fetch fires from mount.
  const [loadingAlbums, setLoadingAlbums] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch the album options on mount. The parent unmounts the dialog when
  // closed, so this runs exactly once per open. setState calls live inside
  // the async callbacks (after a microtask), not synchronously in the
  // effect body.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/chats/${chatId}?action=photo-albums`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load photo albums (${res.status})`)
        return res.json() as Promise<{ albums: AlbumOption[] }>
      })
      .then((data) => {
        if (cancelled) return
        setAlbums(data.albums)
        const defaultOption = data.albums.find(a => a.isDefault) ?? data.albums[0]
        if (defaultOption) {
          setSelectedMountPointId(defaultOption.mountPointId)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoadingAlbums(false)
      })
    return () => {
      cancelled = true
    }
  }, [chatId])

  const selectedAttachment = useMemo(
    () => imageAttachments.find(a => a.id === selectedAttachmentId) ?? imageAttachments[0] ?? null,
    [imageAttachments, selectedAttachmentId]
  )

  const handleSubmit = useCallback(async () => {
    if (!selectedAttachment || !selectedMountPointId) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/chats/${chatId}/messages/${messageId}?action=save-image`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId: selectedAttachment.id,
            mountPointId: selectedMountPointId,
            caption: caption.trim() ? caption.trim() : undefined,
          }),
        }
      )
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { mountPoint?: string; relativePath?: string }
        mountPoint?: string
        relativePath?: string
      }
      if (!res.ok) {
        throw new Error(body.error || `Save failed (${res.status})`)
      }
      const info = {
        mountPoint: body.data?.mountPoint ?? body.mountPoint ?? '',
        relativePath: body.data?.relativePath ?? body.relativePath ?? '',
      }
      onSaved?.(info)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [selectedAttachment, selectedMountPointId, chatId, messageId, caption, onSaved, onClose])

  const groupedAlbums = useMemo(() => {
    if (!albums) return null
    const order: AlbumKind[] = ['character', 'project', 'document-store', 'general']
    const buckets: Record<AlbumKind, AlbumOption[]> = {
      character: [],
      project: [],
      'document-store': [],
      general: [],
    }
    for (const album of albums) {
      buckets[album.kind].push(album)
    }
    return order.flatMap(kind => buckets[kind].length
      ? [{ kind, items: buckets[kind] }]
      : []
    )
  }, [albums])

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Save image to album"
      maxWidth="lg"
      showCloseButton
      footer={
        <FormActions
          onCancel={onClose}
          onSubmit={handleSubmit}
          submitLabel="Save image"
          isLoading={submitting}
          isDisabled={!selectedAttachment || !selectedMountPointId || loadingAlbums}
        />
      }
    >
      <div className="space-y-4">
        {imageAttachments.length > 1 && (
          <div>
            <label className="qt-form-label">Image</label>
            <div className="flex gap-2 flex-wrap">
              {imageAttachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => setSelectedAttachmentId(attachment.id)}
                  className={
                    'qt-button qt-chat-attachment-button' +
                    (attachment.id === selectedAttachmentId ? ' ring-2 ring-offset-1' : '')
                  }
                  title={attachment.filename}
                >
                  { }
                  <img
                    src={attachment.filepath.startsWith('/') ? attachment.filepath : `/${attachment.filepath}`}
                    alt={attachment.filename}
                    width={64}
                    height={64}
                    className="qt-chat-attachment-image"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedAttachment && (
          <div className="flex items-start gap-3">
            { }
            <img
              src={selectedAttachment.filepath.startsWith('/') ? selectedAttachment.filepath : `/${selectedAttachment.filepath}`}
              alt={selectedAttachment.filename}
              width={96}
              height={96}
              className="qt-chat-attachment-image"
            />
            <div className="text-sm opacity-80 break-all">
              {selectedAttachment.filename}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="save-image-album" className="qt-form-label">Album</label>
          {loadingAlbums && (
            <div className="text-sm opacity-70">Loading albums…</div>
          )}
          {!loadingAlbums && groupedAlbums && groupedAlbums.length === 0 && (
            <div className="text-sm opacity-70">
              No photo albums are available for this chat.
            </div>
          )}
          {!loadingAlbums && groupedAlbums && groupedAlbums.length > 0 && (
            <select
              id="save-image-album"
              className="qt-input w-full"
              value={selectedMountPointId}
              onChange={(e) => setSelectedMountPointId(e.target.value)}
            >
              {groupedAlbums.map(group => (
                <optgroup key={group.kind} label={ALBUM_KIND_LABEL[group.kind]}>
                  {group.items.map(option => {
                    const label = option.kind === 'character' && option.isUserCharacter
                      ? `${option.name} (you)`
                      : option.name
                    return (
                      <option key={option.mountPointId} value={option.mountPointId}>
                        {label}
                      </option>
                    )
                  })}
                </optgroup>
              ))}
            </select>
          )}
        </div>

        <div>
          <label htmlFor="save-image-caption" className="qt-form-label">
            Caption <span className="opacity-60">(optional)</span>
          </label>
          <input
            id="save-image-caption"
            type="text"
            className="qt-input w-full"
            placeholder="A short note to remember this image by"
            value={caption}
            maxLength={200}
            onChange={(e) => setCaption(e.target.value)}
          />
        </div>

        {error && (
          <div className="qt-alert-error text-sm" role="alert">
            {error}
          </div>
        )}
      </div>
    </BaseModal>
  )
}

export default SaveImageDialog
