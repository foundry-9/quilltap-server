'use client'

/**
 * Wardrobe Control Dialog
 *
 * The global wardrobe-management surface. Reachable from a button on the
 * left sidebar (and from any participant card in a chat). Lets the operator:
 *
 *  1. Pick any wardrobe container — a character (in or out of chat), the
 *     Quilltap General library, a project, or a group — and browse it with
 *     the shared `WardrobeBrowser`.
 *  2. Create / edit / duplicate / archive / delete wardrobe items there.
 *  3. When invoked with a chat context: stage changes to what the character
 *     wears ("Live outfit") and commit them once, on Done.
 *  4. Compose an outfit in the Outfit Builder, save it, try it on, or draw an
 *     avatar from it (`AvatarGenerationPane`).
 *
 * The logic lives in hooks with pure cores — `useStagedLiveOutfits`,
 * `useFittingRoom`, `useComposerHandlers`, `useWardrobeItemActions`,
 * `useWardrobeListData` — and this file lays them out.
 *
 * Mounted once at the layout level by `WardrobeDialogProvider`.
 *
 * @module components/wardrobe/wardrobe-control-dialog
 */

import { useCallback, useMemo, useState } from 'react'
import { useWardrobeDialog } from '@/components/providers/wardrobe-dialog-provider'
import { showErrorToast } from '@/lib/toast'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { useChatOutfit } from '@/lib/hooks/use-outfit'
import { addToSlotGesture, wearGesture } from '@/lib/wardrobe/staged-live-outfits'
import { wearRefusal } from '@/lib/wardrobe/wearable'
import { WardrobeInstructionsSection } from '@/components/wardrobe/WardrobeInstructionsSection'
import { useOnTabActivated } from '@/components/workspace/workspace-tab-context'
import { OutfitComposer } from './outfit-composer'
import { ImportFromImageModal } from './import-from-image-modal'
import { ImagePromptOptimizerModal } from './image-prompt-optimizer-modal'
import { AvatarGenerationPane } from './AvatarGenerationPane'
import { WardrobeBrowser, WardrobeItemOverlays } from './WardrobeBrowser'
import { useWardrobeListData } from './hooks/useWardrobeListData'
import { useWardrobeItemActions } from './hooks/useWardrobeItemActions'
import { useStagedLiveOutfits } from './hooks/useStagedLiveOutfits'
import { OutfitHistoryTab } from './outfit-history-tab'
import { useFittingRoom } from './hooks/useFittingRoom'
import { useComposerHandlers } from './hooks/useComposerHandlers'
import { usePronounGuidanceFilter } from '@/lib/hooks/use-pronoun-guidance-filter'
import { ItemActionMenu } from '@/components/item-browser/ItemActionMenu'
import { ItemControlDialogShell, useItemControlState } from '@/components/item-browser/ItemControlDialogShell'

type RightTab = 'live' | 'builder' | 'history'

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

/**
 * WardrobeView — the Wardrobe as a left-rail workspace tab. Browse/edit only
 * (no `chatId`, so no "wearing now" column). The chat-scoped path keeps the
 * dialog (which can change what a character is actively wearing). Singleton.
 */
export function WardrobeView({ characterId }: { characterId?: string }) {
  return (
    <WardrobeControlDialogInner
      asTab
      initialCharacterId={characterId ?? null}
      chatId={null}
      onClose={() => {}}
    />
  )
}

interface InnerProps {
  initialCharacterId: string | null
  chatId: string | null
  onClose: () => void
  /** Render bare for a workspace tab instead of inside the floating modal. */
  asTab?: boolean
}

function WardrobeControlDialogInner({
  initialCharacterId,
  chatId,
  onClose,
  asTab = false,
}: InnerProps) {
  const isInChat = chatId !== null
  // Which wardrobe is being browsed: a character's merged view, or one shared
  // container (Quilltap General, a project, a group) edited in place.
  const state = useItemControlState(
    'wardrobe',
    initialCharacterId ? { scope: 'character', id: initialCharacterId } : null,
  )
  const { catalogue, container: selectedContainer, containerLabel: selectedContainerLabel, requestConfirmation } = state
  const isCharacterScope = selectedContainer?.scope === 'character'
  const selectedCharacterId = isCharacterScope ? selectedContainer.id : null

  /**
   * "Show archived". Flipping it re-reads every tier with
   * `?includeArchived=true` rather than filtering what's already loaded — the
   * server owns the hiding, so this list can never disagree with the API.
   */
  const [showArchived, setShowArchived] = useState(false)
  const data = useWardrobeListData(selectedContainer, { chatId, includeArchived: showArchived })
  const items = data.characterItems

  // Pronoun-aware (on by default): one switch for the list and both
  // composers' pickers. Worn chips still resolve against every item.
  const pronounFilter = usePronounGuidanceFilter(selectedCharacterId)
  const pickableItems = useMemo(() => pronounFilter.offer(items), [pronounFilter, items])

  const actions = useWardrobeItemActions({
    container: selectedContainer,
    chatId,
    requestConfirmation,
  })

  // As a rail-opened workspace tab, navigating back refreshes the lists. Safe
  // mid-edit: the fitting-room/live seeding is ref-gated.
  useOnTabActivated(() => {
    void actions.refresh()
  })

  const outfit = useChatOutfit(chatId)
  const wornSlots = isInChat ? outfit.slotsFor(selectedCharacterId) : undefined

  const characterName = useCallback(
    (id: string) => catalogue.characters.find((c) => c.id === id)?.name,
    [catalogue.characters],
  )
  const live = useStagedLiveOutfits({
    chatId,
    characterId: selectedCharacterId,
    wornSlots,
    characterName,
    requestConfirmation,
  })
  const fitting = useFittingRoom({
    chatId,
    characterId: selectedCharacterId,
    wornSlots,
    items,
    requestConfirmation,
  })

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  // An archived garment is retired: every wear gesture refuses it with the
  // same words the equip route and `wardrobe_wear` use (bug 191).
  const refuseIfUnwearable = useCallback((item: WardrobeItem): boolean => {
    const refusal = wearRefusal(item)
    if (refusal) showErrorToast(refusal)
    return refusal !== null
  }, [])

  const liveHandlers = useComposerHandlers({
    itemsById,
    apply: live.apply,
    refuse: refuseIfUnwearable,
  })
  const fittingHandlers = useComposerHandlers({
    itemsById,
    apply: fitting.apply,
    refuse: refuseIfUnwearable,
  })

  const [rightTab, setRightTab] = useState<RightTab>(isInChat ? 'live' : 'builder')
  const [importFromImageOpen, setImportFromImageOpen] = useState(false)
  const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false)

  /**
   * The row buttons route to the Outfit Builder when its tab is active (or
   * always out of chat), or to the Live-tab staging otherwise. Both defer the
   * server commit until Done / Try on.
   */
  const useFittingActions = !isInChat || rightTab === 'builder'

  const rowEquip = useCallback(
    (item: WardrobeItem) => {
      if (refuseIfUnwearable(item)) return
      // Honours the item's `replace` flag across every slot it covers.
      const gesture = wearGesture(item.types[0], item.id, itemsById)
      if (useFittingActions) fitting.apply(gesture)
      else live.apply(gesture)
    },
    [useFittingActions, itemsById, fitting, live, refuseIfUnwearable],
  )

  const rowAddToSlot = useCallback(
    (item: WardrobeItem, slot: WardrobeItemType) => {
      if (useFittingActions) {
        fittingHandlers.onAddToSlot(slot, item.id)
        return
      }
      if (!item.types.includes(slot)) return
      if (refuseIfUnwearable(item)) return
      live.apply(addToSlotGesture(slot, item, itemsById))
    },
    [useFittingActions, fittingHandlers, live, itemsById, refuseIfUnwearable],
  )

  const requestClose = useCallback(() => {
    void (async () => {
      if (await live.flush()) onClose()
    })()
  }, [live, onClose])

  /** Try on: replace what the character wears with the composition, then close. */
  const wearFitting = useCallback(async () => {
    if (await fitting.wear()) onClose()
  }, [fitting, onClose])

  const handleSaveAsOutfit = useCallback(() => {
    if (!selectedCharacterId) return
    actions.openCreate('bundle', fitting.componentIds())
  }, [selectedCharacterId, actions, fitting])

  const selectedCharacter = useMemo(
    () => catalogue.characters.find((c) => c.id === selectedCharacterId) ?? null,
    [catalogue.characters, selectedCharacterId],
  )

  /** The browsed tier owner's name, for the portrait-cue wizard's wording. */
  const optimizerOwnerName = useMemo(() => {
    switch (selectedContainer?.scope) {
      case 'character':
        return selectedCharacter?.name
      case 'project':
        return catalogue.projects.find((p) => p.id === selectedContainer.id)?.name
      case 'group':
        return catalogue.groups.find((g) => g.id === selectedContainer.id)?.name
      default:
        return undefined
    }
  }, [selectedContainer, selectedCharacter, catalogue.projects, catalogue.groups])

  // While an overlay is up, a click inside it (rendered as a sibling) must not
  // close the outer dialog via BaseModal's click-outside handler.
  const overlayOpen = actions.overlayOpen || importFromImageOpen || promptOptimizerOpen

  return (
    <ItemControlDialogShell
      kind="wardrobe"
      state={state}
      asTab={asTab}
      onClose={requestClose}
      overlayOpen={overlayOpen}
      selectAdornment={
        selectedCharacter?.avatarUrl && (
          <img
            src={selectedCharacter.avatarUrl}
            alt=""
            className="w-6 h-6 rounded-full object-cover qt-bg-muted border qt-border-default flex-shrink-0"
          />
        )
      }
      overlays={
        <>
          {/* Import-from-image modal — stacked on top of the dialog */}
          {importFromImageOpen && selectedCharacterId && (
            <ImportFromImageModal
              characterId={selectedCharacterId}
              onClose={() => setImportFromImageOpen(false)}
              onImported={() => {
                void actions.refresh()
              }}
            />
          )}

          {/* Portrait-cue wizard — the browsed tier's own garments only */}
          {promptOptimizerOpen && selectedContainer && (
            <ImagePromptOptimizerModal
              container={selectedContainer}
              ownerName={optimizerOwnerName}
              onClose={() => setPromptOptimizerOpen(false)}
              onApplied={() => {
                void actions.refresh()
              }}
            />
          )}

          <WardrobeItemOverlays
            container={selectedContainer}
            containerLabel={selectedContainerLabel}
            data={data}
            actions={actions}
          />
        </>
      }
    >
        {/* Optional dressing instructions for this container — consulted when
            a character chooses their own opening outfit; nearest tier wins. */}
        <WardrobeInstructionsSection container={selectedContainer} />

        <div className="grid md:grid-cols-2 gap-4">
          <WardrobeBrowser
            container={selectedContainer}
            data={data}
            actions={actions}
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
            pronounFilter={pronounFilter}
            wear={
              isCharacterScope
                ? {
                    equipLabel: useFittingActions ? 'Try on' : 'Wear',
                    addAction: useFittingActions ? 'add' : 'layer',
                    onEquip: rowEquip,
                    onAddToSlot: rowAddToSlot,
                  }
                : undefined
            }
            onImportFromImage={
              selectedCharacterId ? () => setImportFromImageOpen(true) : undefined
            }
            onOptimizePrompts={
              selectedContainer ? () => setPromptOptimizerOpen(true) : undefined
            }
          />

          {/* RIGHT: Live outfit / Outfit Builder / History — Builder always present;
              Live outfit and History only when there is a chat. */}
          {selectedCharacterId && (
            <section className="flex flex-col min-h-0">
              <div className="flex items-center gap-1 mb-2 qt-tab-group">
                {isInChat && (
                  <button
                    type="button"
                    onClick={() => setRightTab('live')}
                  aria-pressed={rightTab === 'live'}
                    className={`qt-tab ${rightTab === 'live' ? 'qt-tab-active' : ''}`}
                  >
                    Live outfit
                    {selectedCharacter && (
                      <span className="qt-text-xs qt-text-secondary ml-1">
                        · {selectedCharacter.name} in this chat
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRightTab('builder')}
                  aria-pressed={rightTab === 'builder'}
                  className={`qt-tab ${rightTab === 'builder' ? 'qt-tab-active' : ''}`}
                >
                  Outfit Builder
                </button>
                {isInChat && (
                  <button
                    type="button"
                    onClick={() => setRightTab('history')}
                  aria-pressed={rightTab === 'history'}
                    className={`qt-tab ${rightTab === 'history' ? 'qt-tab-active' : ''}`}
                  >
                    History
                  </button>
                )}
              </div>

              {rightTab === 'history' && isInChat && chatId ? (
                <OutfitHistoryTab
                  chatId={chatId}
                  characterId={selectedCharacterId}
                  characterName={selectedCharacter?.name ?? 'this character'}
                  hasStagedEdits={live.isDirty(selectedCharacterId)}
                  discardStagedEdits={(options) => live.discard(selectedCharacterId, options)}
                  requestConfirmation={requestConfirmation}
                />
              ) : rightTab === 'live' && isInChat ? (
                <div className="space-y-2 mb-3">
                  <p className="qt-text-xs qt-text-secondary px-1">
                    Edits stage here and apply when you click Done. Nothing happens until then.
                  </p>
                  <OutfitComposer
                    items={items}
                    pickableItems={pickableItems}
                    slots={live.displaySlots}
                    {...liveHandlers}
                  />
                </div>
              ) : (
                <div className="space-y-2 mb-3">
                  <p className="qt-text-xs qt-text-secondary px-1">
                    Compose an outfit. Save it as a reusable bundle, try it on, or
                    generate a preview avatar.
                  </p>
                  <div className="flex flex-wrap gap-1 px-1 items-center">
                    <button
                      type="button"
                      onClick={handleSaveAsOutfit}
                      className="qt-button-primary qt-button-sm"
                      title="Save this composition as a new outfit bundle"
                    >
                      Save as outfit
                    </button>
                    {isInChat && (
                      <button
                        type="button"
                        onClick={wearFitting}
                        className="qt-button-secondary qt-button-sm"
                        title="Replace what the character is wearing with this composition"
                      >
                        Try on
                      </button>
                    )}
                    <ItemActionMenu
                      label="Reset the staged composition"
                      trigger={{ content: 'Reset…' }}
                      entries={[
                        isInChat && { key: 'reset-worn', label: 'Reset to worn', onSelect: () => void fitting.resetToWorn() },
                        { key: 'reset-defaults', label: 'Reset to defaults', onSelect: () => void fitting.resetToDefaults() },
                        { key: 'clear-all', label: 'Clear all', onSelect: () => void fitting.clearAll() },
                      ]}
                    />
                  </div>
                  <OutfitComposer
                    items={items}
                    pickableItems={pickableItems}
                    slots={fitting.slots}
                    {...fittingHandlers}
                  />
                </div>
              )}

              {rightTab === 'builder' && (
                <AvatarGenerationPane
                  characterId={selectedCharacterId}
                  characterName={selectedCharacter?.name ?? ''}
                  chatId={chatId}
                  slots={fitting.slots}
                />
              )}
            </section>
          )}
        </div>
    </ItemControlDialogShell>
  )
}
