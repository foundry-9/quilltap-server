/**
 * Types and interfaces for the embedded photo gallery (Aurora character gallery).
 *
 * Post-Phase-3 the gallery is sourced from a character's vault `photos/`
 * folder (plus legacy `images/avatar.webp` + `images/history/`). The `id`
 * field is a `doc_mount_file_links.id`; `filepath` is the mount-blob URL
 * the UI can drop straight into `<img src>`.
 */

export interface GalleryImage {
  /** doc_mount_file_links.id — the canonical id for set-as-avatar, delete, etc. */
  id: string
  filename: string
  /** mount-blob URL the UI uses as `<img src>`. */
  filepath: string
  /** Optional explicit URL override; rarely set. */
  url?: string
  mimeType: string | null
  size: number
  width?: number
  height?: number
  createdAt: string
  caption: string | null
  /**
   * Free-form retrieval tags parsed out of the kept-image frontmatter
   * (the same `tags: [...]` field `keep_image` writes). These are
   * informational only — they no longer drive gallery membership.
   */
  tags: string[]
}

// EntityType is now only 'character' — personas have been migrated to
// characters with controlledBy: 'user'. The shape is kept so callers can
// stay generic if a future entity type joins.
export type EntityType = 'character'

export interface EmbeddedPhotoGalleryProps {
  entityType: EntityType
  entityId: string
  entityName: string
  /** Current `defaultImageId` — vault link id. Used to render the Avatar badge. */
  currentAvatarId?: string
  onAvatarChange?: (imageId: string | null) => void
  onRefresh?: () => void
}

/**
 * One plate from the avatar configuration cache — a `files` row the wardrobe
 * avatar job stored for a particular outfit / provider / model configuration.
 *
 * Unlike an album photo, a roll's `id` is a `files.id` rather than a
 * `doc_mount_file_links.id`: the cache is keyed in the files table, and that
 * is also the id a chat's `characterAvatars` entry binds. `albumLinkId` is
 * the link the roll has in the character's `photos/` folder once it has been
 * kept, which is what makes the keep button idempotent.
 */
export interface AvatarRoll extends GalleryImage {
  /** Link id in the character's album, when this roll has been kept there. */
  albumLinkId: string | null
  /** True when the character's portrait is this plate. */
  isPortrait: boolean
  /** How many of the character's chats are currently displaying it. */
  usedInChatCount: number
  generationPrompt: string | null
  generationModel: string | null
}

export interface GalleryImageProps {
  image: GalleryImage
  index: number
  isAvatar: boolean
  isUpdating: boolean
  isDeletingImage: boolean
  isConfirmingDelete: boolean
  isMissingImage: boolean
  thumbnailSize: number
  onImageClick: (index: number) => void
  onImageError: () => void
  /** Omitted by read-only grids (wardrobe pictures): no set-as-avatar button. */
  onSetAvatar?: (e: React.MouseEvent) => void
  onDownloadImage: (e: React.MouseEvent) => void
  /** Omitted by read-only grids (wardrobe pictures): no delete button. */
  onDeleteImage?: (e: React.MouseEvent) => void
  entityName: string
  /**
   * Optional "keep this in the album" action. Only the avatar-rolls grid
   * passes it — an album photo is already in the album.
   */
  onSaveToAlbum?: (e: React.MouseEvent) => void
  /** True when the album already holds these bytes; renders as a done state. */
  isInAlbum?: boolean
  /** A roll-level action is in flight; every button on the tile waits. */
  isBusy?: boolean
  /**
   * Optional replacement for the delete button's resting tooltip. The rolls
   * grid uses it to say how many conversations are displaying the plate, so a
   * destructive click is an informed one.
   */
  deleteTitle?: string
  /**
   * Optional caption laid over the foot of the tile — where the picture comes
   * from. The wardrobe grid uses it for the item's title and tier. When set,
   * the action buttons move to the top corner so they never cover it.
   */
  caption?: GalleryImageCaption
}

export interface GalleryImageCaption {
  title: string
  detail: string
}

/**
 * One generated picture of a wardrobe item the character can reach (own
 * vault, a group's store, Quilltap General). `id` is the `files.id`; `url` is
 * the thumbnail the tile shows and `fullUrl` the full-size image.
 */
export interface WardrobeGalleryImage extends GalleryImage {
  fullUrl: string
  itemId: string
  itemTitle: string
  locationLabel: string
  itemArchived: boolean
  isCurrentItemImage: boolean
  generationPrompt: string | null
  generationModel: string | null
}
