'use client'

/**
 * WardrobeReferencePicker — choose a garment or outfit to NAME, not to wear.
 *
 * A reading surface for any author who must write down a wardrobe reference
 * (Pascal's Workbench today): browse what a vantage can reach — a character's
 * pool, or one shared wardrobe — see where each item lives, who can reach it
 * from there, which slots it fills and its picture, and click one to pick it.
 * The picker knows nothing about drafts or files; it hands back the item and
 * whether the author wants it referenced by title or by id.
 *
 * Built from the Salon's wardrobe primitives — `WardrobeItemThumbnail`,
 * `SlotBadge`, `wardrobeOriginLabel`, `selectComposedOutfits` /
 * `selectGarments`, `formatWearLine` — so a user who has dressed a character
 * recognises it at once. It deliberately does not reuse `WardrobeItemRow`,
 * whose kebab of mutations and wear buttons have no place here.
 *
 * Design of record: docs/developer/features/complete/pascal-wardrobe-effect-picker.md §3.4
 *
 * @module components/wardrobe/wardrobe-reference-picker
 */

import { useMemo, useState, type ReactNode } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import { useWardrobeVantageItems } from '@/lib/hooks/use-wardrobe-vantage-items'
import type { TierItem } from '@/lib/hooks/use-wardrobe-tier'
import type { WardrobeVantage } from '@/lib/pascal/tool-draft'
import {
  WARDROBE_SLOT_META,
  WARDROBE_SLOT_TYPES,
  isComposite,
  type WardrobeItemType,
} from '@/lib/schemas/wardrobe.types'
import { selectComposedOutfits, selectGarments } from '@/lib/wardrobe/composed-outfits'
import { wardrobeOriginLabel, wardrobeReachLabel } from '@/lib/wardrobe/wardrobe-container'
import { formatWearLine, wearOf } from '@/lib/wardrobe/wear-display'
import { SlotBadge } from './slot-ui'
import { WardrobeItemThumbnail } from './wardrobe-item-thumbnail'

/** How a picked item is written down: by its title (default) or its exact id. */
export type WardrobeReferenceForm = 'title' | 'id'

export interface WardrobeReferencePickerProps {
  isOpen: boolean
  onClose: () => void
  /** Whose wardrobe to browse. */
  vantage: WardrobeVantage
  /** The character's display name, for "Imogen only" and "Imogen's own". */
  characterName?: string | null
  /** A control rendered at the right of the header — the vantage select. */
  headerControl?: ReactNode
  /**
   * The gesture the pick is for. `take_off` shows archived items by default
   * (archived items may come off); anything else hides them.
   */
  action?: 'wear' | 'take_off'
  /** The slot the gesture names, if any — offers a "Covers <slot> only" filter. */
  slot?: WardrobeItemType | null
  /** The id of the item the reference currently names, highlighted. */
  highlightId?: string | null
  /** The title/id switch, controlled so it lasts the editor session. */
  reference: WardrobeReferenceForm
  onReferenceChange: (next: WardrobeReferenceForm) => void
  onPick: (item: TierItem, opts: { reference: WardrobeReferenceForm }) => void
}

export function WardrobeReferencePicker(props: Readonly<WardrobeReferencePickerProps>) {
  // Mount the body only while open, so its filter state starts fresh each time.
  if (!props.isOpen) return null
  return <PickerBody {...props} />
}

function PickerBody({
  onClose,
  vantage,
  characterName = null,
  headerControl,
  action,
  slot = null,
  highlightId = null,
  reference,
  onReferenceChange,
  onPick,
}: Readonly<WardrobeReferencePickerProps>) {
  const { items, resolutionItems, fetched, loading } = useWardrobeVantageItems(vantage)
  const wardrobeDialog = useWardrobeDialogOptional()

  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(action === 'take_off')
  const [coversSlotOnly, setCoversSlotOnly] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter((item) => {
      if (!showArchived && item.archivedAt) return false
      if (slot && coversSlotOnly && !item.types.includes(slot)) return false
      if (term && !item.title.toLowerCase().includes(term)) return false
      return true
    })
  }, [items, search, showArchived, slot, coversSlotOnly])

  const outfits = useMemo(() => selectComposedOutfits(visible), [visible])
  const garmentGroups = useMemo(() => {
    const garments = selectGarments(visible).sort((a, b) => a.title.localeCompare(b.title))
    return WARDROBE_SLOT_TYPES.map((groupSlot) => ({
      slot: groupSlot,
      // A multi-slot garment hangs under its first slot only, every badge shown.
      items: garments.filter((item) => WARDROBE_SLOT_TYPES.find((s) => item.types.includes(s)) === groupSlot),
    })).filter((group) => group.items.length > 0)
  }, [visible])

  const byId = useMemo(() => new Map(resolutionItems.map((item) => [item.id, item] as const)), [resolutionItems])

  const pick = (item: TierItem) => {
    onPick(item, { reference })
    onClose()
  }

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const renderRow = (item: TierItem, composite: boolean) => {
    const originLabel = wardrobeOriginLabel(item.origin) ?? (characterName ? `${characterName}'s own` : 'their own')
    const reach = wardrobeReachLabel(item.origin, characterName)
    const isOpen = expanded.has(item.id)
    const highlighted = highlightId === item.id
    return (
      <li key={item.id} className={highlighted ? 'qt-bg-muted rounded' : undefined}>
        <div className="flex items-start gap-2 px-2 py-2">
          <button
            type="button"
            onClick={() => pick(item)}
            className="flex flex-1 min-w-0 items-start gap-3 text-left rounded hover:opacity-80"
            aria-label={`Pick ${item.title}`}
            aria-current={highlighted ? 'true' : undefined}
            data-testid="wardrobe-reference-option"
          >
            <WardrobeItemThumbnail fileId={item.imageFileId} size={40} />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block break-words text-sm text-foreground">
                {item.isDefault && (
                  <span title="Default outfit" aria-label="Default outfit">
                    ★{' '}
                  </span>
                )}
                {item.title}
                {composite && <span className="qt-text-secondary"> · outfit</span>}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                {item.types.map((t) => (
                  <SlotBadge key={t} slot={t} />
                ))}
                <span className="qt-badge qt-badge-wardrobe-shared">{originLabel}</span>
                {item.archivedAt && <span className="qt-badge qt-badge-secondary">archived</span>}
              </span>
              <span className="block qt-text-xs qt-text-secondary">
                {reach ? `Reach: ${reach}` : null}
                {reach ? ' · ' : null}
                {formatWearLine(wearOf(item))}
              </span>
            </span>
          </button>
          {composite && (
            <button
              type="button"
              className="qt-button qt-button-ghost qt-button-sm"
              onClick={() => toggleExpanded(item.id)}
              aria-expanded={isOpen}
              aria-label={isOpen ? `Hide what ${item.title} is made of` : `Show what ${item.title} is made of`}
            >
              <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} className="w-4 h-4" />
            </button>
          )}
        </div>
        {composite && isOpen && (
          <ul className="pl-14 pb-2 space-y-0.5 qt-text-xs qt-text-secondary" aria-label={`${item.title} components`}>
            {(item.componentItemIds ?? []).map((componentId) => {
              const component = byId.get(componentId)
              return (
                <li key={componentId}>
                  {component ? (
                    <>
                      {component.title}
                      {component.types.length > 0 && ` — ${component.types.map((t) => WARDROBE_SLOT_META[t].label).join(', ')}`}
                    </>
                  ) : (
                    <em>a piece no longer in reach</em>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </li>
    )
  }

  const footer = (
    <div className="flex items-center justify-between gap-3 flex-wrap w-full">
      <div className="space-y-1">
        <div className="flex items-center gap-3 text-sm" role="radiogroup" aria-label="Reference by">
          <span>Reference by:</span>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="wardrobe-reference-form"
              checked={reference === 'title'}
              onChange={() => onReferenceChange('title')}
            />
            title
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="wardrobe-reference-form"
              checked={reference === 'id'}
              onChange={() => onReferenceChange('id')}
            />
            id
          </label>
        </div>
        {reference === 'id' && <p className="qt-hint">{REFERENCE_FORM_HINT}</p>}
      </div>
      <button type="button" className="qt-button qt-button-secondary" onClick={onClose}>
        Cancel
      </button>
    </div>
  )

  const noVantage = vantage.kind === 'none'
  const emptyVantage = !noVantage && fetched && items.length === 0

  return (
    <BaseModal isOpen onClose={onClose} title="Choose a garment or outfit" maxWidth="2xl" footer={footer} showCloseButton>
      <div className="space-y-3">
        {headerControl && <div>{headerControl}</div>}

        {noVantage ? null : emptyVantage ? (
          <div className="space-y-2 text-sm">
            <p className="qt-text-secondary">Nothing hangs here yet. Items are added from the Wardrobe.</p>
            {wardrobeDialog && (
              <button
                type="button"
                className="qt-button qt-button-secondary qt-button-sm"
                onClick={() => {
                  wardrobeDialog.open(vantage.kind === 'character' ? { characterId: vantage.characterId } : undefined)
                  onClose()
                }}
              >
                Open the Wardrobe
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title…"
                className="qt-input qt-input-sm flex-1 min-w-48"
                aria-label="Search the wardrobe"
                autoFocus
              />
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="qt-checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                Show archived
              </label>
              {slot && (
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    className="qt-checkbox"
                    checked={coversSlotOnly}
                    onChange={(e) => setCoversSlotOnly(e.target.checked)}
                  />
                  Covers {WARDROBE_SLOT_META[slot].label} only
                </label>
              )}
            </div>

            {loading && !fetched && <p className="text-sm qt-text-secondary">Opening the wardrobe…</p>}

            {fetched && outfits.length === 0 && garmentGroups.length === 0 && (
              <p className="text-sm qt-text-secondary">Nothing here answers to that.</p>
            )}

            {outfits.length > 0 && (
              <section aria-label="Outfits" className="space-y-1">
                <h3 className="qt-card-title text-sm">Outfits</h3>
                <ul className="divide-y qt-border-default">{outfits.map((item) => renderRow(item, true))}</ul>
              </section>
            )}

            {garmentGroups.length > 0 && (
              <section aria-label="Garments" className="space-y-2">
                <h3 className="qt-card-title text-sm">Garments</h3>
                {garmentGroups.map((group) => (
                  <div key={group.slot} className="space-y-1">
                    <h4 className="qt-text-xs qt-text-secondary uppercase tracking-wide">
                      {WARDROBE_SLOT_META[group.slot].groupLabel}
                    </h4>
                    <ul className="divide-y qt-border-default">
                      {group.items.map((item) => renderRow(item, isComposite(item)))}
                    </ul>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </BaseModal>
  )
}

/** The one line that explains what choosing an id over a title means. */
export const REFERENCE_FORM_HINT =
  'An id names this exact garment and no other; a title names whichever garment of that name is nearest when the tool runs.'

export default WardrobeReferencePicker
