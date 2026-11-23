'use client'

/**
 * ProposalReview — the review pane a wardrobe wizard shows before anything is
 * created: one editable card per proposed piece (select, title, slots,
 * appropriateness, Portrait Cue, description) and a card that offers to bundle
 * the selected pieces into an outfit. Shared by Import from Image and Import
 * from Instructions; the import itself is `useProposalImport`.
 *
 * The component holds no state: the wizard owns the proposal and hands it in.
 *
 * @module components/wardrobe/proposal-review/ProposalReview
 */

import { useId, type Dispatch, type SetStateAction } from 'react'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { WARDROBE_IMAGE_PROMPT_MAX_LENGTH } from '@/lib/wardrobe/image-prompt-limit'
import {
  MIN_OUTFIT_PIECES,
  type ProposedOutfit,
  type ProposedWardrobeItem,
} from '@/lib/wardrobe/proposal/types'

/** A proposed piece under review. */
export interface ReviewItem extends ProposedWardrobeItem {
  selected: boolean
}

/** The outfit card's state. */
export interface OutfitDraft extends ProposedOutfit {
  enabled: boolean
  /** Composite equip behaviour — on by default, since this is a whole look. */
  replace: boolean
}

/** An existing piece the outfit may also include. */
export interface ReusedPiece {
  id: string
  title: string
  types: WardrobeItemType[]
  selected: boolean
}

export const EMPTY_OUTFIT: OutfitDraft = {
  enabled: false,
  title: '',
  description: '',
  appropriateness: '',
  replace: true,
}

/** Proposed pieces as review state: everything selected, a cue always present. */
export function toReviewItems(items: readonly ProposedWardrobeItem[]): ReviewItem[] {
  return items.map((item) => ({ ...item, imagePrompt: item.imagePrompt ?? '', selected: true }))
}

/** The outfit card for a fresh proposal: ticked and filled when the model named one. */
export function toOutfitDraft(outfit: ProposedOutfit | null, pieceCount: number): OutfitDraft {
  return outfit && pieceCount >= MIN_OUTFIT_PIECES ? { ...EMPTY_OUTFIT, ...outfit, enabled: true } : EMPTY_OUTFIT
}

/** What the review state means for the import button and the import itself. */
export function summarizeReview(
  items: readonly ReviewItem[],
  outfit: OutfitDraft,
  reused: readonly ReusedPiece[] = [],
) {
  const selectedCount = items.filter((i) => i.selected).length
  const reusedCount = reused.filter((r) => r.selected).length
  // An outfit needs something new in it, and two pieces all told.
  const outfitAvailable = selectedCount >= 1 && selectedCount + reusedCount >= MIN_OUTFIT_PIECES
  const willCreateOutfit = outfitAvailable && outfit.enabled
  return {
    selectedCount,
    reusedCount,
    outfitAvailable,
    willCreateOutfit,
    outfitTitleMissing: willCreateOutfit && outfit.title.trim().length === 0,
  }
}

export interface ProposalReviewProps {
  items: readonly ReviewItem[]
  onItemsChange: Dispatch<SetStateAction<ReviewItem[]>>
  outfit: OutfitDraft
  onOutfitChange: Dispatch<SetStateAction<OutfitDraft>>
  /** Existing pieces offered for the outfit; absent or empty hides the list. */
  reused?: readonly ReusedPiece[]
  onReusedChange?: Dispatch<SetStateAction<ReusedPiece[]>>
}

export function ProposalReview({
  items,
  onItemsChange,
  outfit,
  onOutfitChange,
  reused = [],
  onReusedChange,
}: ProposalReviewProps) {
  const id = useId()
  const { selectedCount, reusedCount, outfitAvailable, willCreateOutfit } = summarizeReview(items, outfit, reused)

  const updateItem = (index: number, updates: Partial<ReviewItem>) => {
    onItemsChange((prev) => prev.map((item, i) => (i === index ? { ...item, ...updates } : item)))
  }

  const toggleItemType = (index: number, type: WardrobeItemType) => {
    onItemsChange((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        const types = item.types.includes(type) ? item.types.filter((t) => t !== type) : [...item.types, type]
        return { ...item, types: types.length > 0 ? types : [type] }
      }),
    )
  }

  const bundleCount = selectedCount + reusedCount

  return (
    <>
      {/* Item cards */}
      <div className="space-y-4">
        {items.map((item, index) => (
          <div
            key={index}
            className={`border qt-border-default rounded-lg p-4 space-y-3 transition-opacity ${
              item.selected ? '' : 'opacity-50'
            }`}
          >
            {/* Select checkbox + title */}
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={item.selected}
                onChange={(e) => updateItem(index, { selected: e.target.checked })}
                aria-label={`Import ${item.title || 'this item'}`}
                className="qt-checkbox mt-1"
              />
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={item.title}
                  onChange={(e) => updateItem(index, { title: e.target.value })}
                  aria-label="Item title"
                  className="qt-input text-sm font-medium w-full"
                  placeholder="Item title"
                />
              </div>
            </div>

            {item.selected && (
              <>
                {/* Types */}
                <div className="ml-8">
                  <span className="qt-label text-xs mb-1 block">Type(s)</span>
                  <div className="flex flex-wrap gap-2">
                    {WARDROBE_SLOT_TYPES.map((type) => (
                      <label key={type} className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.types.includes(type)}
                          onChange={() => toggleItemType(index, type)}
                          className="qt-checkbox"
                        />
                        <span className="text-xs capitalize qt-text">{type}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Appropriateness */}
                <div className="ml-8">
                  <label htmlFor={`${id}-appropriateness-${index}`} className="qt-label text-xs mb-1 block">
                    Appropriateness
                  </label>
                  <input
                    id={`${id}-appropriateness-${index}`}
                    type="text"
                    value={item.appropriateness}
                    onChange={(e) => updateItem(index, { appropriateness: e.target.value })}
                    className="qt-input text-sm w-full"
                    placeholder="e.g., formal, casual, intimate"
                    maxLength={200}
                  />
                </div>

                {/* Portrait cue — what the image-makers are told */}
                <div className="ml-8">
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor={`${id}-image-prompt-${index}`} className="qt-label text-xs block">
                      Portrait Cue
                    </label>
                    <span className="text-xs qt-text-secondary">
                      {item.imagePrompt.length}/{WARDROBE_IMAGE_PROMPT_MAX_LENGTH}
                    </span>
                  </div>
                  <input
                    id={`${id}-image-prompt-${index}`}
                    type="text"
                    value={item.imagePrompt}
                    onChange={(e) => updateItem(index, { imagePrompt: e.target.value })}
                    className="qt-input text-sm w-full"
                    placeholder="e.g., worn brown leather duster with brass buttons"
                    maxLength={WARDROBE_IMAGE_PROMPT_MAX_LENGTH}
                  />
                </div>

                {/* Description */}
                <div className="ml-8">
                  <label htmlFor={`${id}-description-${index}`} className="qt-label text-xs mb-1 block">
                    Description
                  </label>
                  <textarea
                    id={`${id}-description-${index}`}
                    value={item.description}
                    onChange={(e) => updateItem(index, { description: e.target.value })}
                    rows={3}
                    className="qt-textarea text-sm w-full"
                    placeholder="Item description..."
                  />
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Ensemble — bundles the imported pieces into one outfit */}
      <div
        className={`border qt-border-default rounded-lg p-4 space-y-3 transition-opacity ${
          willCreateOutfit ? '' : 'opacity-50'
        }`}
      >
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={willCreateOutfit}
            disabled={!outfitAvailable}
            onChange={(e) => onOutfitChange((prev) => ({ ...prev, enabled: e.target.checked }))}
            className="qt-checkbox mt-1"
          />
          <span className="flex-1 min-w-0">
            <span className="text-sm font-medium qt-text block">Also create an outfit from these pieces</span>
            <span className="text-xs qt-text-secondary block mt-0.5">
              {outfitAvailable
                ? `Bundles the ${bundleCount} selected items into a single outfit you can wear in one gesture.`
                : 'Select at least two items to bundle them into an outfit.'}
            </span>
          </span>
        </label>

        {willCreateOutfit && (
          <>
            <div className="ml-8">
              <label htmlFor={`${id}-outfit-title`} className="qt-label text-xs mb-1 block">
                Outfit title
              </label>
              <input
                id={`${id}-outfit-title`}
                type="text"
                value={outfit.title}
                onChange={(e) => onOutfitChange((prev) => ({ ...prev, title: e.target.value }))}
                className="qt-input text-sm font-medium w-full"
                placeholder="e.g., Midnight Gala Ensemble"
              />
            </div>

            <div className="ml-8">
              <label htmlFor={`${id}-outfit-appropriateness`} className="qt-label text-xs mb-1 block">
                Appropriateness
              </label>
              <input
                id={`${id}-outfit-appropriateness`}
                type="text"
                value={outfit.appropriateness}
                onChange={(e) => onOutfitChange((prev) => ({ ...prev, appropriateness: e.target.value }))}
                className="qt-input text-sm w-full"
                placeholder="e.g., formal, evening"
                maxLength={200}
              />
            </div>

            <div className="ml-8">
              <label htmlFor={`${id}-outfit-description`} className="qt-label text-xs mb-1 block">
                Description
              </label>
              <textarea
                id={`${id}-outfit-description`}
                value={outfit.description}
                onChange={(e) => onOutfitChange((prev) => ({ ...prev, description: e.target.value }))}
                rows={2}
                className="qt-textarea text-sm w-full"
                placeholder="The overall look..."
              />
            </div>

            {reused.length > 0 && onReusedChange && (
              <fieldset className="ml-8">
                <legend className="qt-label text-xs mb-1 block">Also include from this rail</legend>
                <div className="space-y-1">
                  {reused.map((piece) => (
                    <label key={piece.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={piece.selected}
                        onChange={(e) =>
                          onReusedChange((prev) =>
                            prev.map((p) => (p.id === piece.id ? { ...p, selected: e.target.checked } : p)),
                          )
                        }
                        className="qt-checkbox"
                      />
                      <span className="text-sm qt-text">{piece.title}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs qt-text-secondary mt-1">
                  Already hanging here; the outfit borrows them rather than stitching duplicates.
                </p>
              </fieldset>
            )}

            <label className="ml-8 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={outfit.replace}
                onChange={(e) => onOutfitChange((prev) => ({ ...prev, replace: e.target.checked }))}
                className="qt-checkbox mt-0.5"
              />
              <span className="text-sm qt-text">
                Replace everything in its slots when worn
                <span className="block text-xs qt-text-secondary">
                  Off layers the pieces over whatever is already on.
                </span>
              </span>
            </label>
          </>
        )}
      </div>
    </>
  )
}
