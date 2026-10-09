/**
 * Wardrobe item drafts — the one form-state shape for creating or editing a
 * wardrobe item on the client, and the one way it becomes a request body.
 *
 * The item editor, Duplicate, and Save-as-outfit all start from a draft and
 * send `draftToPayload(draft)`, so a create body is spelled once. Validation
 * goes through `wardrobeItemFieldsSchema` — the same schema the routes parse
 * the body with — so the client can't accept what the server will refuse.
 *
 * Client-safe: no server imports.
 *
 * @module lib/wardrobe/item-draft
 */

import {
  isComposite,
  wardrobeItemFieldsSchema,
  type WardrobeItem,
  type WardrobeItemType,
} from '@/lib/schemas/wardrobe.types'

/** Editable fields of a wardrobe item, as a form holds them (strings, never null). */
export interface WardrobeItemDraft {
  title: string
  description: string
  imagePrompt: string
  appropriateness: string
  isDefault: boolean
  types: WardrobeItemType[]
  /** Non-empty makes the item a composite (an outfit). */
  componentItemIds: string[]
  /** Composite-only: clear the designated slots on equip instead of layering. */
  replace: boolean
}

/** The create/update body the wardrobe item routes accept. */
export interface WardrobeItemPayload {
  title: string
  description: string | null
  imagePrompt: string | null
  types: WardrobeItemType[]
  appropriateness: string | null
  isDefault: boolean
  componentItemIds: string[]
  replace: boolean
}

/** A blank draft, optionally pre-filled. */
export function emptyDraft(overrides?: Partial<WardrobeItemDraft>): WardrobeItemDraft {
  return {
    title: '',
    description: '',
    imagePrompt: '',
    appropriateness: '',
    isDefault: false,
    types: [],
    componentItemIds: [],
    replace: false,
    ...overrides,
  }
}

/** A draft holding an existing item's editable fields. */
export function draftFromItem(item: WardrobeItem): WardrobeItemDraft {
  return {
    title: item.title,
    description: item.description ?? '',
    imagePrompt: item.imagePrompt ?? '',
    appropriateness: item.appropriateness ?? '',
    isDefault: item.isDefault ?? false,
    types: [...item.types],
    componentItemIds: [...(item.componentItemIds ?? [])],
    replace: item.replace ?? false,
  }
}

/**
 * The request body for a draft. Optional text fields left blank go as null;
 * `replace` is sent only for a composite (a leaf always replaces its slots).
 */
export function draftToPayload(draft: WardrobeItemDraft): WardrobeItemPayload {
  const blankToNull = (value: string): string | null => (value.trim() ? value : null)
  return {
    title: draft.title.trim(),
    description: blankToNull(draft.description),
    imagePrompt: blankToNull(draft.imagePrompt),
    types: [...draft.types],
    appropriateness: blankToNull(draft.appropriateness),
    isDefault: draft.isDefault,
    componentItemIds: [...draft.componentItemIds],
    replace: isComposite(draft) ? draft.replace : false,
  }
}

export type DraftValidation =
  | { ok: true; payload: WardrobeItemPayload }
  | { ok: false; error: string }

/**
 * Validate a draft against the routes' own body schema. Returns the payload
 * to send, or the first problem as a sentence for a toast.
 */
export function validateDraft(draft: WardrobeItemDraft): DraftValidation {
  const payload = draftToPayload(draft)
  const parsed = wardrobeItemFieldsSchema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'This item is not valid' }
  }
  return { ok: true, payload }
}

