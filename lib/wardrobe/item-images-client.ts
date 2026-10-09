/**
 * Client-side contract for wardrobe item pictures: the URLs of the images
 * route (`/api/v1/wardrobe/[itemId]/images`), the shapes it answers with, and
 * thin fetch helpers. Client-safe — type-only imports from the server side.
 *
 * Every component that shows or changes an item's picture (the editor's Image
 * section, the row thumbnail and its "Generate image" menu entry, the picker
 * thumbnails, Import from image) goes through here, so the URL shape lives in
 * one place.
 *
 * @module lib/wardrobe/item-images-client
 */

import type { RouteAttempt } from '@/lib/schemas/chat.types'
import type { FileSource } from '@/lib/schemas/file.types'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import { encodeWardrobeContainer } from '@/lib/wardrobe/wardrobe-container'

/** One picture in an item's history. */
export interface WardrobeItemImageSummary {
  fileId: string
  url: string
  thumbnailUrl: string
  source: FileSource
  createdAt: string
  prompt?: string
  model?: string
}

export interface WardrobeItemImagesResponse {
  current: string | null
  images: WardrobeItemImageSummary[]
}

export interface WardrobeItemImageGenerateResponse {
  image: WardrobeItemImageSummary
  current: string
  prompt: string
  subject: 'worn' | 'catalogue'
  profile: { id: string; name: string }
  rerouted: boolean
  trail: RouteAttempt[] | null
}

/** The 422 body's `details` when the provider (and any understudy) declined. */
export interface WardrobeItemImageRefusal {
  trail: RouteAttempt[] | null
  refused: boolean
}

export type WardrobeItemImageAction =
  | 'generate'
  | 'upload'
  | 'set-current'
  | 'delete-image'
  | 'save-targets'
  | 'save-to-store'

/** `/api/v1/wardrobe/<itemId>/images?scope=…&id=…[&action=…]` */
export function wardrobeItemImagesUrl(
  itemId: string,
  container: WardrobeContainer,
  action?: WardrobeItemImageAction,
): string {
  const params = new URLSearchParams({ scope: container.scope })
  if (container.id) params.set('id', container.id)
  if (action) params.set('action', action)
  return `/api/v1/wardrobe/${encodeURIComponent(itemId)}/images?${params.toString()}`
}

/** The thumbnail URL for a picture's file id. */
export function wardrobeImageThumbnailUrl(fileId: string): string {
  return `/api/v1/files/${fileId}?action=thumbnail`
}

/** The full-size URL for a picture's file id. */
export function wardrobeImageUrl(fileId: string): string {
  return `/api/v1/files/${fileId}`
}

/** The query-key suffix for a container (`scope:id`). */
export function wardrobeImagesContainerKey(container: WardrobeContainer): string {
  return encodeWardrobeContainer(container)
}

/** An error from the images route, carrying the parsed body. */
export class WardrobeImageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly refusal: WardrobeItemImageRefusal | null,
  ) {
    super(message)
    this.name = 'WardrobeImageRequestError'
  }
}

async function readJsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message = (body && typeof body.error === 'string' && body.error) || `Request failed (${res.status})`
    const details = body?.details
    const refusal = details && typeof details === 'object' && 'trail' in details
      ? (details as WardrobeItemImageRefusal)
      : null
    throw new WardrobeImageRequestError(message, res.status, refusal)
  }
  return body as T
}

/** Generate a picture (with the designated profile unless `imageProfileId` overrides once). */
export async function generateWardrobeItemImage(
  itemId: string,
  container: WardrobeContainer,
  imageProfileId?: string | null,
): Promise<WardrobeItemImageGenerateResponse> {
  const res = await fetch(wardrobeItemImagesUrl(itemId, container, 'generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(imageProfileId ? { imageProfileId } : {}),
  })
  return readJsonOrThrow<WardrobeItemImageGenerateResponse>(res)
}

/** Attach a picture by hand (`uploaded`) or from Import from image (`imported`). */
export async function uploadWardrobeItemImage(
  itemId: string,
  container: WardrobeContainer,
  file: File,
  kind: 'uploaded' | 'imported' = 'uploaded',
): Promise<{ image: WardrobeItemImageSummary; current: string }> {
  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)
  const res = await fetch(wardrobeItemImagesUrl(itemId, container, 'upload'), {
    method: 'POST',
    body: form,
  })
  return readJsonOrThrow(res)
}

/** Make one of the item's pictures current. */
export async function setCurrentWardrobeItemImage(
  itemId: string,
  container: WardrobeContainer,
  fileId: string,
): Promise<{ current: string | null }> {
  const res = await fetch(wardrobeItemImagesUrl(itemId, container, 'set-current'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId }),
  })
  return readJsonOrThrow(res)
}

/** Delete one of the item's pictures; the next-newest becomes current. */
export async function deleteWardrobeItemImage(
  itemId: string,
  container: WardrobeContainer,
  fileId: string,
): Promise<{ current: string | null }> {
  const res = await fetch(wardrobeItemImagesUrl(itemId, container, 'delete-image'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId }),
  })
  return readJsonOrThrow(res)
}
