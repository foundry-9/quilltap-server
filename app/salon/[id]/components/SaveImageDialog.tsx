'use client'

/**
 * SaveImageDialog — operator-facing "save this attached image" picker.
 *
 * Opens from three doors: the per-message Save Image toolbar button, the
 * chat gallery's Save, and the wardrobe picture viewer's Save. For the two
 * Salon doors it fetches the chat's candidate photo albums (chat participants'
 * vaults, the project album, linked document stores, Quilltap General); the
 * wardrobe viewer belongs to no chat and is offered every document store. It
 * then POSTs the chosen album to whichever save-image action matches the door
 * it came from.
 *
 * The two differ only in the route they post to. The message route's guard —
 * *is this image attached to this message* — is a real invariant there, and
 * half the gallery has no message at all (a Lantern backdrop posted with alerts
 * off, a participant's standing portrait), so the gallery posts to a
 * chat-scoped twin whose guard is *is this image in this chat's gallery*.
 * The wardrobe door posts to the item's images route, whose guard is *is this
 * one of the item's own pictures*. Everything the reader sees is identical.
 *
 * Mirrors the LLM `keep_image` save path under the hood — see
 * `lib/photos/save-image-to-album.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'
import { wardrobeItemImagesUrl } from '@/lib/wardrobe/item-images-client'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
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

/**
 * Which door the dialog was opened from, and therefore where it reads its
 * albums and which route it posts to. `fileId` is the image selected when it
 * opened; the in-dialog picker can move it when a message carries several.
 */
export type SaveImageTarget =
  | { kind: 'message'; chatId: string; messageId: string; fileId: string }
  | { kind: 'chat'; chatId: string; fileId: string }
  | { kind: 'wardrobe'; itemId: string; container: WardrobeContainer; fileId: string }

/** Where the album list for a door is read from. */
function albumsUrlFor(target: SaveImageTarget): string {
  return target.kind === 'wardrobe'
    ? wardrobeItemImagesUrl(target.itemId, target.container, 'save-targets')
    : `/api/v1/chats/${target.chatId}?action=photo-albums`
}

/** Where a door posts the save. */
function saveUrlFor(target: SaveImageTarget): string {
  switch (target.kind) {
    case 'message':
      return `/api/v1/chats/${target.chatId}/messages/${target.messageId}?action=save-image`
    case 'chat':
      return `/api/v1/chats/${target.chatId}?action=save-image`
    case 'wardrobe':
      return wardrobeItemImagesUrl(target.itemId, target.container, 'save-to-store')
  }
}

interface SaveImageDialogProps {
  isOpen: boolean
  onClose: () => void
  target: SaveImageTarget
  /**
   * Candidate images for the in-dialog picker — every image attachment on the
   * message, for the ribbon. The gallery passes the one entry it opened on.
   */
  attachments: MessageAttachment[]
  onSaved?: (info: { mountPoint: string; relativePath: string }) => void
  /**
   * Extra overlay classes — a raised `z-[…]` when the dialog opens over
   * something that already sits above the ordinary dialog layer.
   */
  overlayClassName?: string
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
  target,
  attachments,
  onSaved,
  overlayClassName,
}: Readonly<SaveImageDialogProps>) {
  const imageAttachments = useMemo(
    () => attachments.filter(a => a.mimeType.startsWith('image/')),
    [attachments]
  )

  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string>(() =>
    target.fileId || imageAttachments[0]?.id || ''
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

  const albumsUrl = albumsUrlFor(target)

  // Fetch the album options on mount. The parent unmounts the dialog when
  // closed, so this runs exactly once per open. setState calls live inside
  // the async callbacks (after a microtask), not synchronously in the
  // effect body.
  useEffect(() => {
    let cancelled = false
    fetch(albumsUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load photo albums (${res.status})`)
        const body = (await res.json()) as { albums?: AlbumOption[] }
        return body.albums ?? []
      })
      .then((list) => {
        if (cancelled) return
        setAlbums(list)
        const defaultOption = list.find(a => a.isDefault) ?? list[0]
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
  }, [albumsUrl])

  const selectedAttachment = useMemo(
    () => imageAttachments.find(a => a.id === selectedAttachmentId) ?? imageAttachments[0] ?? null,
    [imageAttachments, selectedAttachmentId]
  )

  const handleSubmit = useCallback(async () => {
    if (!selectedAttachment || !selectedMountPointId) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(saveUrlFor(target), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: selectedAttachment.id,
          mountPointId: selectedMountPointId,
          caption: caption.trim() ? caption.trim() : undefined,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        code?: string
        keptAt?: string
        relativePath?: string
        data?: { mountPoint?: string; relativePath?: string }
        mountPoint?: string
      }
      if (!res.ok) {
        // The album already holds these bytes. That is an answer, not a
        // failure, and it deserves to be said in those words.
        if (res.status === 409 || body.code === 'ALREADY_SAVED') {
          const when = body.keptAt ? new Date(body.keptAt).toLocaleDateString() : null
          throw new Error(
            when
              ? `That picture is already in this album — it was filed there on ${when}.`
              : 'That picture is already in this album.'
          )
        }
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
  }, [selectedAttachment, selectedMountPointId, target, caption, onSaved, onClose])

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
      overlayClassName={overlayClassName}
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
              {target.kind === 'wardrobe'
                ? 'No document stores are available.'
                : 'No photo albums are available for this chat.'}
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
