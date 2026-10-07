'use client'

/**
 * Picture — the wardrobe item editor's image section.
 *
 * Sits directly under Title. Shows the item's current picture (or an empty
 * dashed frame), a Generate button with a profile picker, an Upload button, a
 * caption naming who drew the current picture, and a history strip of every
 * picture the item has had, each of which can be made current or taken down.
 *
 * Every URL and request goes through `lib/wardrobe/item-images-client`; the
 * history is one TanStack query keyed by `queryKeys.wardrobe.images`. Any change
 * to the current picture invalidates `queryKeys.wardrobe.all` and calls
 * `onImageChanged` so the list rows behind the editor refresh their thumbnails.
 *
 * In create mode there is no item id to hang a picture on, so the section is
 * present but inert.
 *
 * Design of record: docs/developer/features/wardrobe-item-images.md §6.1
 *
 * @module components/wardrobe/wardrobe-item-editor/WardrobeItemImageSection
 */

import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import type { ChatSettings } from '@/components/settings/chat-settings/types'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import {
  WardrobeImageRequestError,
  deleteWardrobeItemImage,
  generateWardrobeItemImage,
  setCurrentWardrobeItemImage,
  uploadWardrobeItemImage,
  wardrobeImageThumbnailUrl,
  wardrobeImageUrl,
  wardrobeImagesContainerKey,
  wardrobeItemImagesUrl,
  type WardrobeItemImageGenerateResponse,
  type WardrobeItemImageSummary,
  type WardrobeItemImagesResponse,
} from '@/lib/wardrobe/item-images-client'

/** Types accepted by Upload — the same set as Import from image. */
export const WARDROBE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const ACCEPTED_TYPES = new Set(WARDROBE_IMAGE_ACCEPT.split(','))
/** Upload ceiling, checked here before the bytes travel (the route checks again). */
export const WARDROBE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** The fields of `/api/v1/image-profiles` the picker renders. */
interface ImageProfileOption {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault?: boolean
  isDangerousCompatible?: boolean
}

interface WardrobeItemImageSectionProps {
  /** The item being edited; null in create mode (the section is inert). */
  item: WardrobeItem | null
  /** The item's home container — the one its edit route is addressed through. */
  container: WardrobeContainer | null
  /** Called after the current picture changes, so the lists can refresh. */
  onImageChanged?: () => void
}

/** The designated wardrobe profile, read off the chat-settings row. */
function selectDesignatedProfileId(settings: Pick<ChatSettings, 'wardrobeImageSettings'>): string | null {
  return settings.wardrobeImageSettings?.imageProfileId ?? null
}

function profileLabel(p: ImageProfileOption): string {
  return `${p.name}${p.isDefault ? ' (default)' : ''} — ${p.provider}/${p.modelName}${
    p.isDangerousCompatible ? ' · uncensored' : ''
  }`
}

export function WardrobeItemImageSection({
  item,
  container,
  onImageChanged,
}: WardrobeItemImageSectionProps) {
  if (!item || !container) {
    return (
      <section aria-label="Picture" data-testid="wardrobe-item-image-section">
        <span className="qt-label mb-1 block">Picture</span>
        <div
          className="flex items-center justify-center rounded border-2 border-dashed qt-border-default px-4 py-6 text-center"
          data-testid="wardrobe-item-image-inert"
        >
          <p className="qt-text-small qt-text-secondary italic">
            Save the item first; then it may sit for its portrait.
          </p>
        </div>
      </section>
    )
  }
  return (
    <ActiveImageSection item={item} container={container} onImageChanged={onImageChanged} />
  )
}

function ActiveImageSection({
  item,
  container,
  onImageChanged,
}: {
  item: WardrobeItem
  container: WardrobeContainer
  onImageChanged?: () => void
}) {
  const queryClient = useQueryClient()
  const containerKey = wardrobeImagesContainerKey(container)
  const isCatalogue = container.scope !== 'character'
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickedProfileId, setPickedProfileId] = useState<string | null>(null)
  const [refusalNotice, setRefusalNotice] = useState<string | null>(null)
  // The last generation's answer — the only place `profile.name` and
  // `rerouted` are known, so the caption uses it while it is still current.
  const [lastGeneration, setLastGeneration] =
    useState<WardrobeItemImageGenerateResponse | null>(null)

  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- `containerKey` is `container`, serialized
  const { data: imagesData, isLoading: imagesLoading } = useQuery({
    queryKey: queryKeys.wardrobe.images(item.id, containerKey),
    queryFn: ({ signal }) =>
      apiFetch<WardrobeItemImagesResponse>(wardrobeItemImagesUrl(item.id, container), { signal }),
  })

  const { data: profilesData } = useQuery({
    queryKey: queryKeys.imageProfiles.all,
    queryFn: ({ signal }) =>
      apiFetch<{ profiles: ImageProfileOption[] }>('/api/v1/image-profiles', { signal }),
  })
  const profiles = useMemo(() => profilesData?.profiles ?? [], [profilesData])

  const { data: designatedProfileId = null } = useChatSettingsQuery(selectDesignatedProfileId)

  // Preselect the designated profile (or the user's default) in the picker.
  const preselectedProfileId = useMemo(() => {
    if (designatedProfileId && profiles.some((p) => p.id === designatedProfileId)) {
      return designatedProfileId
    }
    return (profiles.find((p) => p.isDefault) ?? profiles[0])?.id ?? null
  }, [designatedProfileId, profiles])
  // Until the operator picks, the picker shows the preselection.
  const effectivePickedProfileId = pickedProfileId ?? preselectedProfileId

  const images = imagesData?.images ?? []
  const currentId = imagesData?.current ?? item.imageFileId ?? null
  const currentImage: WardrobeItemImageSummary | null =
    images.find((i) => i.fileId === currentId) ?? null

  /** After any change to the picture set: refresh the history and every wardrobe list. */
  const afterChange = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.images(item.id) })
    // The lists carry `imageFileId`; their thumbnails follow the current picture.
    void queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.all })
    onImageChanged?.()
  }

  const generateMutation = useMutation({
    mutationFn: (imageProfileId: string | null) =>
      generateWardrobeItemImage(item.id, container, imageProfileId),
    onMutate: () => {
      setRefusalNotice(null)
    },
    onSuccess: async (result) => {
      setLastGeneration(result)
      setPickerOpen(false)
      showSuccessToast(
        result.rerouted
          ? 'The portrait is hung — drawn at the uncensored desk'
          : 'The portrait is hung',
      )
      await afterChange()
    },
    onError: (error) => {
      if (error instanceof WardrobeImageRequestError && error.status === 422) {
        const last = error.refusal?.trail?.[error.refusal.trail.length - 1]
        const who = last?.profileName ?? 'The artist'
        const why = last?.detail ? ` (${last.detail})` : ''
        setRefusalNotice(`${who} declined to paint it${why}. Try another profile.`)
        setPickerOpen(true)
        return
      }
      showErrorToast(error instanceof Error ? error.message : 'Failed to generate a picture')
    },
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadWardrobeItemImage(item.id, container, file, 'uploaded'),
    onSuccess: async () => {
      setLastGeneration(null)
      setRefusalNotice(null)
      showSuccessToast('Picture hung')
      await afterChange()
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : 'Failed to upload the picture')
    },
  })

  const setCurrentMutation = useMutation({
    mutationFn: (fileId: string) => setCurrentWardrobeItemImage(item.id, container, fileId),
    onSuccess: afterChange,
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : 'Failed to change the picture')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => deleteWardrobeItemImage(item.id, container, fileId),
    onSuccess: async () => {
      showSuccessToast('Picture taken down')
      await afterChange()
    },
    onError: (error) => {
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete the picture')
    },
  })

  const generating = generateMutation.isPending
  const busy =
    generating ||
    uploadMutation.isPending ||
    setCurrentMutation.isPending ||
    deleteMutation.isPending
  const noProfiles = profiles.length === 0

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    // Reset so choosing the same file again still fires a change.
    e.target.value = ''
    if (!file) return
    if (!ACCEPTED_TYPES.has(file.type)) {
      showErrorToast('Only JPEG, PNG, WebP or GIF pictures may be hung')
      return
    }
    if (file.size > WARDROBE_IMAGE_MAX_BYTES) {
      showErrorToast('That picture weighs more than 10 MB; the easel will not bear it')
      return
    }
    uploadMutation.mutate(file)
  }

  const handleDelete = async (fileId: string): Promise<void> => {
    if (!(await showConfirmation('Take this picture down for good? It cannot be rehung.'))) return
    deleteMutation.mutate(fileId)
  }

  // Caption: who drew the current picture, and whether it took the long way round.
  const caption = (() => {
    if (!currentImage) return null
    const parts: string[] = []
    if (lastGeneration && lastGeneration.current === currentImage.fileId) {
      parts.push(`Drawn by ${lastGeneration.profile.name}`)
      if (lastGeneration.rerouted) parts.push('rerouted to the uncensored desk')
    } else if (currentImage.source === 'GENERATED') {
      parts.push(currentImage.model ? `Drawn by ${currentImage.model}` : 'Drawn to order')
    } else if (currentImage.source === 'IMPORTED') {
      parts.push('From the imported photograph')
    } else {
      parts.push('Hung by hand')
    }
    if (isCatalogue) parts.push('catalogue shot')
    return parts.join(' · ')
  })()

  const buttons = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex">
        <button
          type="button"
          className="qt-button-secondary qt-button-sm rounded-r-none"
          onClick={() => generateMutation.mutate(null)}
          disabled={busy || noProfiles}
          title={
            noProfiles
              ? 'No image profiles are configured'
              : 'Paint it with the designated wardrobe profile'
          }
        >
          <Icon name="sparkles" className="w-4 h-4 mr-1" />
          {generating ? 'Generating…' : 'Generate'}
        </button>
        <button
          type="button"
          className="qt-button-secondary qt-button-sm rounded-l-none border-l qt-border-default px-2"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={busy || noProfiles}
          aria-label="Choose an image profile"
          aria-expanded={pickerOpen}
          title="Choose another image profile, just this once"
        >
          <Icon name="chevron-down" className="w-4 h-4" />
        </button>
      </div>
      <button
        type="button"
        className="qt-button-secondary qt-button-sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        title="Hang a picture of your own (JPEG, PNG, WebP or GIF; 10 MB at most)"
      >
        <Icon name="upload" className="w-4 h-4 mr-1" />
        {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={WARDROBE_IMAGE_ACCEPT}
        className="hidden"
        onChange={handleFileChosen}
        data-testid="wardrobe-item-image-upload-input"
        aria-label="Upload a picture"
      />
    </div>
  )

  return (
    <section aria-label="Picture" data-testid="wardrobe-item-image-section">
      <span className="qt-label mb-1 block">Picture</span>

      {currentImage ? (
        <div className="relative inline-block">
          <a href={wardrobeImageUrl(currentImage.fileId)} target="_blank" rel="noreferrer">
            <img
              src={wardrobeImageUrl(currentImage.fileId)}
              alt={`Picture of ${item.title}`}
              className="max-h-[16rem] w-auto rounded border qt-border-default qt-bg-muted"
              data-testid="wardrobe-item-image-current"
            />
          </a>
          {generating && (
            <div className="absolute inset-0 flex items-center justify-center rounded qt-bg-default/70">
              <div
                className="animate-spin rounded-full h-8 w-8 border-b-2 qt-border-primary"
                role="status"
                aria-label="Generating a picture"
              />
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded border-2 border-dashed qt-border-default px-4 py-6 text-center"
          style={{ minHeight: '10rem' }}
        >
          {generating ? (
            <>
              <div
                className="animate-spin rounded-full h-8 w-8 border-b-2 qt-border-primary"
                role="status"
                aria-label="Generating a picture"
              />
              <p className="qt-text-small qt-text-secondary italic">
                The artist is at the easel…
              </p>
            </>
          ) : (
            <p className="qt-text-small qt-text-secondary italic">
              {imagesLoading ? 'Fetching the portfolio…' : 'No picture yet'}
            </p>
          )}
          {buttons}
        </div>
      )}

      {currentImage && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {buttons}
          {caption && (
            <span className="qt-text-xs qt-text-secondary" data-testid="wardrobe-item-image-caption">
              {caption}
            </span>
          )}
        </div>
      )}

      {refusalNotice && (
        <div
          role="alert"
          className="mt-2 rounded border qt-border-warning/50 qt-bg-warning/10 px-3 py-2 qt-text-small qt-text-warning"
        >
          {refusalNotice}
        </div>
      )}

      {pickerOpen && !noProfiles && (
        <div className="mt-2 qt-card py-2 px-3 qt-bg-muted/30 flex flex-wrap items-center gap-2">
          <label htmlFor={`wardrobe-item-image-profile-${item.id}`} className="text-sm qt-text-secondary">
            Image model
          </label>
          <select
            id={`wardrobe-item-image-profile-${item.id}`}
            className="qt-select flex-1 min-w-[12rem]"
            value={effectivePickedProfileId ?? ''}
            onChange={(e) => setPickedProfileId(e.target.value || null)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {profileLabel(p)}
                {p.id === designatedProfileId ? ' · designated' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="qt-button-primary qt-button-sm"
            onClick={() => generateMutation.mutate(effectivePickedProfileId)}
            disabled={busy || !effectivePickedProfileId}
          >
            {generating ? 'Generating…' : 'Generate with this'}
          </button>
          <button
            type="button"
            className="qt-button-ghost qt-button-sm"
            onClick={() => setPickerOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {images.length > 0 && (
        <div className="mt-2">
          <span className="qt-text-xs qt-text-secondary block mb-1">History</span>
          <ul className="flex flex-wrap gap-2" aria-label="Picture history">
            {images.map((img) => {
              const isCurrent = img.fileId === currentId
              return (
                <li
                  key={img.fileId}
                  className={`group relative rounded overflow-hidden border-2 ${
                    isCurrent ? 'qt-border-primary' : 'qt-border-default'
                  }`}
                  data-testid="wardrobe-item-image-history-entry"
                >
                  <img
                    src={wardrobeImageThumbnailUrl(img.fileId)}
                    alt={isCurrent ? 'Current picture' : 'Earlier picture'}
                    title={img.prompt ?? undefined}
                    className="block w-16 h-16 object-cover qt-bg-muted"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 flex flex-col items-stretch justify-end gap-0.5 p-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    {!isCurrent && (
                      <button
                        type="button"
                        className="qt-button-secondary qt-button-sm !px-1 !py-0 qt-text-xs"
                        onClick={() => setCurrentMutation.mutate(img.fileId)}
                        disabled={busy}
                        title="Make current"
                      >
                        Make current
                      </button>
                    )}
                    <button
                      type="button"
                      className="qt-button-secondary qt-button-sm !px-1 !py-0 qt-text-xs qt-text-destructive"
                      onClick={() => void handleDelete(img.fileId)}
                      disabled={busy}
                      title="Delete this picture"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
