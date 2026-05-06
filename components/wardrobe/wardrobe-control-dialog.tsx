'use client'

/**
 * Wardrobe Control Dialog
 *
 * The global wardrobe-management surface. Reachable from a button on the
 * left sidebar (and from any participant card in a chat). Lets the operator:
 *
 *  1. Pick any character (in or out of chat) and view their wardrobe.
 *  2. Create / edit / delete wardrobe items, including composites.
 *  3. Toggle `isDefault` on each item via a star button.
 *  4. When invoked with a chat context: see the chat's "wearing now" outfit
 *     and equip / layer / clear items per slot using the existing
 *     `?action=equip` API.
 *  5. Generate a new avatar — replacing the live chat avatar in chat, or
 *     producing a downloadable preview when out of chat. Either path can
 *     pick a non-default image model for that one generation.
 *
 * Mounted once at the layout level by `WardrobeDialogProvider`.
 *
 * @module components/wardrobe/wardrobe-control-dialog
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWardrobeDialog } from '@/components/providers/wardrobe-dialog-provider'
import { BaseModal } from '@/components/ui/BaseModal'
import { fetchJson } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { WARDROBE_SLOT_TYPES, EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { useOutfit } from '@/lib/hooks/use-outfit'
import { WardrobeItemEditor } from './wardrobe-item-editor'
import { WardrobeItemRow } from './wardrobe-item-row'
import { EquippedSlotRow } from './equipped-slot-row'

/** Build a fresh fitting-room snapshot from the items marked `isDefault: true`. */
function buildDefaultFittingSlots(items: WardrobeItem[]): EquippedSlots {
  const next: EquippedSlots = { top: [], bottom: [], footwear: [], accessories: [] }
  for (const item of items) {
    if (!item.isDefault || item.archivedAt) continue
    for (const slot of item.types) next[slot].push(item.id)
  }
  return next
}

/** Deep-copy a slot snapshot (so callers can mutate without aliasing). */
function cloneSlots(slots: EquippedSlots): EquippedSlots {
  return {
    top: [...slots.top],
    bottom: [...slots.bottom],
    footwear: [...slots.footwear],
    accessories: [...slots.accessories],
  }
}

interface CharacterSummary {
  id: string
  name: string
  avatarUrl?: string | null
}

interface ImageProfileSummary {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
}

type FilterChip = 'all' | WardrobeItemType | 'composite'
const FILTER_CHIPS: FilterChip[] = ['all', 'top', 'bottom', 'footwear', 'accessories', 'composite']

/**
 * Wrapper component used by the layout. Reads context from the provider and
 * renders the inner dialog only when open.
 */
export function WardrobeControlDialog() {
  const dialog = useWardrobeDialog()
  if (!dialog.isOpen) return null
  return (
    <WardrobeControlDialogInner
      key={`${dialog.context?.characterId ?? 'auto'}|${dialog.context?.chatId ?? 'no-chat'}`}
      initialCharacterId={dialog.context?.characterId ?? null}
      chatId={dialog.context?.chatId ?? null}
      onClose={dialog.close}
    />
  )
}

interface InnerProps {
  initialCharacterId: string | null
  chatId: string | null
  onClose: () => void
}

function WardrobeControlDialogInner({
  initialCharacterId,
  chatId,
  onClose,
}: InnerProps) {
  const [characters, setCharacters] = useState<CharacterSummary[]>([])
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(initialCharacterId)
  const [items, setItems] = useState<WardrobeItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [editingItem, setEditingItem] = useState<WardrobeItem | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [filter, setFilter] = useState<FilterChip>('all')
  const [updatingDefaultId, setUpdatingDefaultId] = useState<string | null>(null)

  // Image profiles + avatar gen state
  const [imageProfiles, setImageProfiles] = useState<ImageProfileSummary[]>([])
  const [selectedImageProfileId, setSelectedImageProfileId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFilename, setPreviewFilename] = useState<string | null>(null)

  // Fitting room — a transient outfit composition used as the avatar source.
  // Distinct from the chat's stored `equippedOutfit` (the "Wearing now" tab):
  // changes here never hit the equip API. Seeded from Wearing now (in chat)
  // or from the character's defaults (out of chat) when the character loads.
  const [fittingSlots, setFittingSlots] = useState<EquippedSlots>(() => ({
    ...EMPTY_EQUIPPED_SLOTS,
  }))
  const isInChat = chatId !== null
  const [rightTab, setRightTab] = useState<'wearing' | 'fitting'>(
    isInChat ? 'wearing' : 'fitting',
  )
  const fittingSeedKeyRef = useRef<string | null>(null)

  const characterIdsForOutfit = useMemo(
    () => (selectedCharacterId ? [selectedCharacterId] : []),
    [selectedCharacterId],
  )
  const outfit = useOutfit(chatId, characterIdsForOutfit)

  // ---------------------------------------------------------------------------
  // Load characters once when the dialog opens
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/v1/characters')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { characters?: CharacterSummary[] }
        if (cancelled) return
        const sorted = [...(data.characters ?? [])].sort((a, b) => a.name.localeCompare(b.name))
        setCharacters(sorted)
        // Auto-select if nothing was specified
        setSelectedCharacterId((prev) => prev ?? sorted[0]?.id ?? null)
      } catch (err) {
        console.warn('[WardrobeControlDialog] Failed to load characters', err)
        if (!cancelled) setCharacters([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Load image profiles (for the avatar generator)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/v1/image-profiles')
        if (!res.ok) return
        const data = (await res.json()) as { profiles?: ImageProfileSummary[] }
        if (cancelled) return
        const profiles = data.profiles ?? []
        setImageProfiles(profiles)
        // Preselect the system default for first-render convenience
        const def = profiles.find((p) => p.isDefault) ?? profiles[0]
        setSelectedImageProfileId((prev) => prev ?? def?.id ?? null)
      } catch (err) {
        console.warn('[WardrobeControlDialog] Failed to load image profiles', err)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Load wardrobe items for the selected character (incl. shared archetypes)
  // ---------------------------------------------------------------------------
  const loadItems = useCallback(async (characterId: string): Promise<void> => {
    setItemsLoading(true)
    try {
      const [personalRes, archetypeRes] = await Promise.all([
        fetch(`/api/v1/characters/${characterId}/wardrobe`),
        fetch('/api/v1/wardrobe'),
      ])
      const collected: WardrobeItem[] = []
      if (personalRes.ok) {
        const data = (await personalRes.json()) as { wardrobeItems?: WardrobeItem[] }
        for (const w of data.wardrobeItems ?? []) collected.push(w)
      }
      if (archetypeRes.ok) {
        const data = (await archetypeRes.json()) as { wardrobeItems?: WardrobeItem[] }
        for (const w of data.wardrobeItems ?? []) {
          if (!collected.some((c) => c.id === w.id)) collected.push(w)
        }
      }
      setItems(collected)
    } catch (err) {
      console.warn('[WardrobeControlDialog] Failed to load wardrobe', err)
      setItems([])
    } finally {
      setItemsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedCharacterId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadItems wraps an async fetch; the setState lands well after this effect tick
    void loadItems(selectedCharacterId)
  }, [selectedCharacterId, loadItems])

  // ---------------------------------------------------------------------------
  // Fitting-room seeding
  //
  // Seed once per character. In chat we wait for both `outfit.outfitState`
  // and `items` to be populated so the seed reflects what the character is
  // actually wearing; out of chat we wait for `items` so we can pick out the
  // defaults. The ref prevents reseeding on every render.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedCharacterId) return
    const wornSlots = isInChat ? outfit.outfitState[selectedCharacterId]?.slots : undefined
    if (isInChat && !wornSlots) return
    if (items.length === 0 && !wornSlots) return

    const seedKey = `${selectedCharacterId}|${chatId ?? 'no-chat'}`
    if (fittingSeedKeyRef.current === seedKey) return
    fittingSeedKeyRef.current = seedKey

    const seed = isInChat && wornSlots
      ? cloneSlots(wornSlots)
      : buildDefaultFittingSlots(items)
    setFittingSlots(seed)
  }, [selectedCharacterId, chatId, isInChat, outfit.outfitState, items])

  // ---------------------------------------------------------------------------
  // Filtered items for display
  // ---------------------------------------------------------------------------
  const filteredItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title))
    return sorted.filter((i) => {
      if (i.archivedAt) return false
      if (filter === 'all') return true
      if (filter === 'composite') return i.componentItemIds.length > 0
      return i.types.includes(filter)
    })
  }, [items, filter])

  // ---------------------------------------------------------------------------
  // Item action handlers
  // ---------------------------------------------------------------------------
  const handleToggleDefault = useCallback(
    async (item: WardrobeItem) => {
      if (!selectedCharacterId) return
      const url = item.characterId
        ? `/api/v1/characters/${item.characterId}/wardrobe/${item.id}`
        : `/api/v1/wardrobe/${item.id}`
      setUpdatingDefaultId(item.id)
      try {
        const result = await fetchJson<{ wardrobeItem: WardrobeItem }>(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isDefault: !item.isDefault }),
        })
        if (!result.ok) {
          showErrorToast(result.error || 'Failed to update item')
          return
        }
        await loadItems(selectedCharacterId)
      } finally {
        setUpdatingDefaultId(null)
      }
    },
    [selectedCharacterId, loadItems],
  )

  const handleDelete = useCallback(
    async (item: WardrobeItem) => {
      if (!selectedCharacterId) return
      if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return
      const url = item.characterId
        ? `/api/v1/characters/${item.characterId}/wardrobe/${item.id}`
        : `/api/v1/wardrobe/${item.id}`
      const result = await fetchJson(url, { method: 'DELETE' })
      if (!result.ok) {
        showErrorToast(result.error || 'Failed to delete item')
        return
      }
      showSuccessToast(`Deleted "${item.title}"`)
      await loadItems(selectedCharacterId)
      if (isInChat) {
        outfit.invalidateWardrobe(selectedCharacterId)
        await outfit.refreshOutfit()
      }
    },
    [selectedCharacterId, loadItems, isInChat, outfit],
  )

  const handleEquipItem = useCallback(
    async (item: WardrobeItem) => {
      if (!selectedCharacterId || !isInChat) return
      const result = await outfit.equipItem(selectedCharacterId, item.id)
      if (!result) showErrorToast('Failed to equip item')
    },
    [selectedCharacterId, isInChat, outfit],
  )

  const handleAddToSlot = useCallback(
    async (item: WardrobeItem, slot: WardrobeItemType) => {
      if (!selectedCharacterId || !isInChat) return
      const result = await outfit.addToSlot(selectedCharacterId, slot, item.id)
      if (!result) showErrorToast('Failed to layer item')
    },
    [selectedCharacterId, isInChat, outfit],
  )

  const handleSlotAdd = useCallback(
    async (slot: WardrobeItemType, itemId: string) => {
      if (!selectedCharacterId || !isInChat) return
      const result = await outfit.addToSlot(selectedCharacterId, slot, itemId)
      if (!result) showErrorToast('Failed to add to slot')
    },
    [selectedCharacterId, isInChat, outfit],
  )

  const handleSlotRemove = useCallback(
    async (slot: WardrobeItemType, itemId: string) => {
      if (!selectedCharacterId || !isInChat) return
      const result = await outfit.removeFromSlot(selectedCharacterId, slot, itemId)
      if (!result) showErrorToast('Failed to remove item')
    },
    [selectedCharacterId, isInChat, outfit],
  )

  const handleSlotClear = useCallback(
    async (slot: WardrobeItemType) => {
      if (!selectedCharacterId || !isInChat) return
      const result = await outfit.removeFromSlot(selectedCharacterId, slot)
      if (!result) showErrorToast('Failed to clear slot')
    },
    [selectedCharacterId, isInChat, outfit],
  )

  // ---------------------------------------------------------------------------
  // Fitting-room mutations — transient; never hit the equip API.
  // ---------------------------------------------------------------------------
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const fittingAdd = useCallback(
    (slot: WardrobeItemType, itemId: string) => {
      const item = itemsById.get(itemId)
      if (!item) return
      if (!item.types.includes(slot)) return
      setFittingSlots((prev) => {
        if (prev[slot].includes(itemId)) return prev
        return { ...prev, [slot]: [...prev[slot], itemId] }
      })
    },
    [itemsById],
  )

  const fittingRemove = useCallback((slot: WardrobeItemType, itemId: string) => {
    setFittingSlots((prev) => ({ ...prev, [slot]: prev[slot].filter((id) => id !== itemId) }))
  }, [])

  const fittingClear = useCallback((slot: WardrobeItemType) => {
    setFittingSlots((prev) => ({ ...prev, [slot]: [] }))
  }, [])

  const fittingResetToWorn = useCallback(() => {
    if (!selectedCharacterId) return
    const wornSlots = outfit.outfitState[selectedCharacterId]?.slots
    setFittingSlots(wornSlots ? cloneSlots(wornSlots) : { ...EMPTY_EQUIPPED_SLOTS })
  }, [selectedCharacterId, outfit.outfitState])

  const fittingResetToDefaults = useCallback(() => {
    setFittingSlots(buildDefaultFittingSlots(items))
  }, [items])

  const fittingClearAll = useCallback(() => {
    setFittingSlots({ ...EMPTY_EQUIPPED_SLOTS })
  }, [])

  /**
   * Wear this fitting room composition: atomic replace via `mode: 'set_all'`.
   * On success the dialog closes — the operator's intent ("put it on and let
   * me see") is complete, and Aurora + avatar gen fire immediately on the
   * server side.
   */
  const wearFitting = useCallback(async () => {
    if (!selectedCharacterId || !chatId) return
    const result = await fetchJson<{ equippedSlots: EquippedSlots }>(
      `/api/v1/chats/${chatId}?action=equip`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: selectedCharacterId,
          mode: 'set_all',
          slots: fittingSlots,
        }),
      },
    )
    if (!result.ok) {
      showErrorToast(result.error || 'Failed to wear this outfit')
      return
    }
    showSuccessToast('Worn!')
    outfit.invalidateWardrobe(selectedCharacterId)
    await outfit.refreshOutfit()
    onClose()
  }, [selectedCharacterId, chatId, fittingSlots, outfit, onClose])

  /**
   * Add an item via the wardrobe row's "Wear" / "+ Layer" buttons. Routes to
   * the fitting room when the fitting tab is active (or always out of chat),
   * else hits the live equip API.
   */
  const useFittingActions = !isInChat || rightTab === 'fitting'

  const rowEquip = useCallback(
    async (item: WardrobeItem) => {
      if (useFittingActions) {
        // Replace each slot the item covers with [item.id], matching the
        // semantics of `equipItem` for the live state.
        setFittingSlots((prev) => {
          const next = cloneSlots(prev)
          for (const slot of item.types) next[slot] = [item.id]
          return next
        })
        return
      }
      await handleEquipItem(item)
    },
    [useFittingActions, handleEquipItem],
  )

  const rowAddToSlot = useCallback(
    async (item: WardrobeItem, slot: WardrobeItemType) => {
      if (useFittingActions) {
        fittingAdd(slot, item.id)
        return
      }
      await handleAddToSlot(item, slot)
    },
    [useFittingActions, fittingAdd, handleAddToSlot],
  )

  // ---------------------------------------------------------------------------
  // Avatar generation
  // ---------------------------------------------------------------------------
  const handleGenerateAvatar = useCallback(async () => {
    if (!selectedCharacterId) return
    setPreviewUrl(null)
    setPreviewFilename(null)
    setGenerating(true)

    try {
      if (isInChat && chatId) {
        // The fitting-room slots flow through as a one-shot override; the
        // chat's stored `equippedOutfit` is unaffected.
        const result = await fetchJson<{ queued: boolean }>(
          `/api/v1/chats/${chatId}?action=regenerate-avatar`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              characterId: selectedCharacterId,
              equippedSlots: fittingSlots,
              ...(selectedImageProfileId ? { imageProfileId: selectedImageProfileId } : {}),
            }),
          },
        )
        if (!result.ok) {
          showErrorToast(result.error || 'Failed to queue avatar generation')
        } else {
          showSuccessToast('Avatar generation queued — the new portrait will appear shortly.')
        }
      } else {
        const result = await fetchJson<{ fileId: string; url: string }>(
          '/api/v1/wardrobe/preview-avatar',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              characterId: selectedCharacterId,
              equippedSlots: fittingSlots,
              ...(selectedImageProfileId ? { imageProfileId: selectedImageProfileId } : {}),
            }),
          },
        )
        if (!result.ok || !result.data) {
          showErrorToast(result.error || 'Failed to generate preview')
        } else {
          setPreviewUrl(result.data.url)
          const character = characters.find((c) => c.id === selectedCharacterId)
          setPreviewFilename(`${character?.name.replace(/[^a-zA-Z0-9]/g, '_') ?? 'avatar'}_preview.webp`)
        }
      }
    } finally {
      setGenerating(false)
    }
  }, [
    selectedCharacterId,
    isInChat,
    chatId,
    selectedImageProfileId,
    fittingSlots,
    characters,
  ])

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  const equippedSlots = selectedCharacterId
    ? outfit.outfitState[selectedCharacterId]?.slots ?? null
    : null

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === selectedCharacterId) ?? null,
    [characters, selectedCharacterId],
  )

  // While the editor is up, don't let a click inside it (rendered as a
  // sibling) close the outer dialog via BaseModal's click-outside handler.
  const editorOpen = Boolean(editingItem || creatingNew)

  return (
    <>
      <BaseModal
        isOpen
        onClose={onClose}
        title="Wardrobe"
        maxWidth="4xl"
        showCloseButton
        closeOnClickOutside={!editorOpen}
        closeOnEscape={!editorOpen}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button
              type="button"
              onClick={onClose}
              className="qt-button-secondary qt-button-sm"
            >
              Done
            </button>
          </div>
        }
      >
        {/* Character selector + filter chips */}
        <div className="flex flex-col gap-3 mb-3">
          <div className="flex items-center gap-2">
            <label htmlFor="wardrobe-char-select" className="qt-text-sm qt-text-secondary">
              Character:
            </label>
            <select
              id="wardrobe-char-select"
              className="qt-select flex-1 max-w-md"
              value={selectedCharacterId ?? ''}
              onChange={(e) => setSelectedCharacterId(e.target.value || null)}
            >
              {characters.length === 0 && (
                <option value="" disabled>
                  No characters available
                </option>
              )}
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {isInChat && (
              <span className="qt-text-xs qt-text-secondary">
                In chat — equip controls active
              </span>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* LEFT: Wardrobe list */}
          <section className="flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="qt-section-title">Wardrobe</h3>
              <button
                type="button"
                className="qt-button-primary qt-button-sm"
                disabled={!selectedCharacterId}
                onClick={() => setCreatingNew(true)}
              >
                + New Item
              </button>
            </div>

            <div className="flex flex-wrap gap-1 mb-2">
              {FILTER_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setFilter(chip)}
                  className={`qt-button-sm ${filter === chip ? 'qt-button-secondary' : 'qt-button-ghost'}`}
                >
                  {chip === 'all'
                    ? 'All'
                    : chip === 'composite'
                      ? 'Composites'
                      : chip[0].toUpperCase() + chip.slice(1)}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 max-h-[55vh]">
              {!selectedCharacterId ? (
                <div className="qt-text-sm qt-text-secondary px-3 py-4">
                  Select a character to see their wardrobe.
                </div>
              ) : itemsLoading ? (
                <div className="qt-text-sm qt-text-secondary px-3 py-4">Loading…</div>
              ) : filteredItems.length === 0 ? (
                <div className="qt-text-sm qt-text-secondary px-3 py-4">
                  No items match this filter.
                </div>
              ) : (
                filteredItems.map((item) => (
                  <WardrobeItemRow
                    key={item.id}
                    item={item}
                    allItems={items}
                    // `inChat` here gates the visibility of the row's
                    // Wear/+Layer buttons; we want them visible whenever
                    // the dialog is showing equip-able state — that's any
                    // time (in chat → live or fitting; out of chat → fitting).
                    inChat
                    equipLabel={useFittingActions ? 'Try on' : 'Wear'}
                    layerLabel={useFittingActions ? '+ Add' : '+ Layer'}
                    isUpdatingDefault={updatingDefaultId === item.id}
                    onToggleDefault={handleToggleDefault}
                    onEdit={(it) => setEditingItem(it)}
                    onDelete={handleDelete}
                    onEquip={rowEquip}
                    onAddToSlot={rowAddToSlot}
                  />
                ))
              )}
            </div>
          </section>

          {/* RIGHT: Wearing now / Fitting room — fitting room always present;
              "Wearing now" only when there's a chat to mutate against. */}
          {selectedCharacterId && (
            <section className="flex flex-col min-h-0">
              <div className="flex items-center gap-1 mb-2 qt-tab-group">
                {isInChat && (
                  <button
                    type="button"
                    onClick={() => setRightTab('wearing')}
                    className={`qt-tab ${rightTab === 'wearing' ? 'qt-tab-active' : ''}`}
                  >
                    Wearing now
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRightTab('fitting')}
                  className={`qt-tab ${rightTab === 'fitting' ? 'qt-tab-active' : ''}`}
                >
                  Fitting room
                </button>
              </div>

              {rightTab === 'wearing' && isInChat ? (
                <div className="space-y-2 mb-3">
                  <p className="qt-text-xs qt-text-secondary px-1">
                    What this character is actually wearing in this chat. Edits here
                    persist immediately.
                  </p>
                  {WARDROBE_SLOT_TYPES.map((slot) => (
                    <EquippedSlotRow
                      key={slot}
                      slot={slot}
                      equippedIds={equippedSlots?.[slot] ?? []}
                      allItems={items}
                      onAdd={handleSlotAdd}
                      onRemove={handleSlotRemove}
                      onClear={handleSlotClear}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-2 mb-3">
                  <p className="qt-text-xs qt-text-secondary px-1">
                    A virtual outfit just for the avatar generator — no equip API
                    calls, nothing committed to the chat. Edit freely, then either
                    click Generate avatar below or, in chat, hit&nbsp;
                    <em>Wear this</em> to commit the composition.
                  </p>
                  <div className="flex flex-wrap gap-1 px-1">
                    {isInChat && (
                      <button
                        type="button"
                        onClick={wearFitting}
                        className="qt-button-primary qt-button-sm"
                        title="Replace what the character is wearing with this fitting room composition"
                      >
                        Wear this
                      </button>
                    )}
                    {isInChat && (
                      <button
                        type="button"
                        onClick={fittingResetToWorn}
                        className="qt-button-ghost qt-button-sm"
                        title="Re-seed the fitting room from what the character is currently wearing"
                      >
                        Reset to worn
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={fittingResetToDefaults}
                      className="qt-button-ghost qt-button-sm"
                      title="Re-seed the fitting room from the character's default-outfit items"
                    >
                      Reset to defaults
                    </button>
                    <button
                      type="button"
                      onClick={fittingClearAll}
                      className="qt-button-ghost qt-button-sm qt-text-secondary"
                      title="Empty every slot in the fitting room"
                    >
                      Clear all
                    </button>
                  </div>
                  {WARDROBE_SLOT_TYPES.map((slot) => (
                    <EquippedSlotRow
                      key={slot}
                      slot={slot}
                      equippedIds={fittingSlots[slot]}
                      allItems={items}
                      onAdd={fittingAdd}
                      onRemove={fittingRemove}
                      onClear={fittingClear}
                    />
                  ))}
                </div>
              )}

              {rightTab === 'fitting' && (
                <AvatarGenerationPane
                  selectedCharacterName={selectedCharacter?.name ?? ''}
                  imageProfiles={imageProfiles}
                  selectedImageProfileId={selectedImageProfileId}
                  onSelectImageProfile={setSelectedImageProfileId}
                  generating={generating}
                  onGenerate={handleGenerateAvatar}
                  inChat={isInChat}
                  previewUrl={isInChat ? null : previewUrl}
                  previewFilename={isInChat ? null : previewFilename}
                  onDiscardPreview={() => {
                    setPreviewUrl(null)
                    setPreviewFilename(null)
                  }}
                />
              )}
            </section>
          )}
        </div>
      </BaseModal>

      {/* Inline editor — stacked on top of the dialog */}
      {(editingItem || creatingNew) && selectedCharacterId && (
        <WardrobeItemEditor
          characterId={selectedCharacterId}
          item={editingItem}
          isShared={false}
          onClose={() => {
            setEditingItem(null)
            setCreatingNew(false)
          }}
          onSave={async () => {
            setEditingItem(null)
            setCreatingNew(false)
            await loadItems(selectedCharacterId)
            if (isInChat) {
              outfit.invalidateWardrobe(selectedCharacterId)
              await outfit.refreshOutfit()
            }
          }}
        />
      )}
    </>
  )
}

// =============================================================================
// Avatar generation pane
// =============================================================================

interface AvatarGenerationPaneProps {
  selectedCharacterName: string
  imageProfiles: ImageProfileSummary[]
  selectedImageProfileId: string | null
  onSelectImageProfile: (id: string | null) => void
  generating: boolean
  onGenerate: () => void
  inChat: boolean
  previewUrl: string | null
  previewFilename: string | null
  onDiscardPreview: () => void
}

function AvatarGenerationPane({
  selectedCharacterName,
  imageProfiles,
  selectedImageProfileId,
  onSelectImageProfile,
  generating,
  onGenerate,
  inChat,
  previewUrl,
  previewFilename,
  onDiscardPreview,
}: AvatarGenerationPaneProps) {
  const downloadRef = useRef<HTMLAnchorElement>(null)

  const handleDownload = useCallback(() => {
    downloadRef.current?.click()
  }, [])

  return (
    <div className="qt-card py-3 px-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="wardrobe-image-profile" className="qt-label">
            Image model
          </label>
          <select
            id="wardrobe-image-profile"
            className="qt-select"
            value={selectedImageProfileId ?? ''}
            onChange={(e) => onSelectImageProfile(e.target.value || null)}
          >
            {imageProfiles.length === 0 && (
              <option value="" disabled>
                No image profiles configured
              </option>
            )}
            {imageProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? ' (default)' : ''} — {p.provider}/{p.modelName}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="qt-button-primary qt-button-sm"
          onClick={onGenerate}
          disabled={generating || imageProfiles.length === 0}
        >
          {generating ? 'Generating…' : inChat ? 'Generate avatar' : 'Preview'}
        </button>
      </div>

      <p className="mt-2 qt-text-xs qt-text-small">
        {inChat
          ? `In-chat regeneration replaces ${selectedCharacterName || 'this character'}'s avatar in this chat using the outfit shown above. The chat's default model is not changed.`
          : `Generates a one-off preview against the character's defaults. Nothing is saved to the character's avatar — download the file to keep it.`}
      </p>

      {!inChat && previewUrl && (
        <div className="mt-3 flex flex-col sm:flex-row gap-3 items-start">
          <img
            src={previewUrl}
            alt={`Preview of ${selectedCharacterName}`}
            className="qt-bg-muted rounded border qt-border-default max-h-[40vh]"
          />
          <div className="flex flex-col gap-2">
            <a
              ref={downloadRef}
              href={previewUrl}
              download={previewFilename ?? 'avatar-preview.webp'}
              className="hidden"
            >
              download
            </a>
            <button
              type="button"
              onClick={handleDownload}
              className="qt-button-primary qt-button-sm"
            >
              Download
            </button>
            <button
              type="button"
              onClick={onDiscardPreview}
              className="qt-button-ghost qt-button-sm"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
