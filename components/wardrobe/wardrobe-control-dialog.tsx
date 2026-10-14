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

import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { useWardrobeDialog } from '@/components/providers/wardrobe-dialog-provider'
import { BaseModal } from '@/components/ui/BaseModal'
import { showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { useClickOutside } from '@/hooks/useClickOutside'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { useChatOutfit } from '@/lib/hooks/use-outfit'
import { addToSlotGesture, wearGesture } from '@/lib/wardrobe/staged-live-outfits'
import { wearRefusal } from '@/lib/wardrobe/wearable'
import {
  GENERAL_CONTAINER,
  GENERAL_WARDROBE_NAME,
  decodeWardrobeContainer,
  encodeWardrobeContainer,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import { WardrobeInstructionsSection } from '@/components/wardrobe/WardrobeInstructionsSection'
import { useOnTabActivated } from '@/components/workspace/workspace-tab-context'
import { OutfitComposer } from './outfit-composer'
import { ImportFromImageModal } from './import-from-image-modal'
import { AvatarGenerationPane } from './AvatarGenerationPane'
import { WardrobeBrowser, WardrobeItemOverlays } from './WardrobeBrowser'
import { useWardrobeListData } from './hooks/useWardrobeListData'
import { useWardrobeItemActions } from './hooks/useWardrobeItemActions'
import { useStagedLiveOutfits } from './hooks/useStagedLiveOutfits'
import { useFittingRoom } from './hooks/useFittingRoom'
import { useComposerHandlers } from './hooks/useComposerHandlers'

interface CharacterSummary {
  id: string
  name: string
  avatarUrl?: string | null
}

/** A project or group offered as a browsable shared wardrobe container. */
interface ContainerSummary {
  id: string
  name: string
}

type RightTab = 'live' | 'builder'

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name)

/**
 * Every place a wardrobe item can live, for the container selector: the
 * characters, projects and groups lists, read through their shared keys.
 */
function useWardrobeCatalogue() {
  const characters = useQuery({
    queryKey: queryKeys.characters.list(),
    queryFn: ({ signal }) =>
      apiFetch<{ characters?: CharacterSummary[] }>('/api/v1/characters', { signal }),
  })
  const projects = useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: ({ signal }) =>
      apiFetch<{ projects?: ContainerSummary[] }>('/api/v1/projects', { signal }),
  })
  const groups = useQuery({
    queryKey: queryKeys.groups.list(),
    queryFn: ({ signal }) => apiFetch<{ groups?: ContainerSummary[] }>('/api/v1/groups', { signal }),
  })
  return {
    characters: useMemo(
      () => [...(characters.data?.characters ?? [])].sort(byName),
      [characters.data],
    ),
    /** Settled (successfully or not) — the auto-selection waits for this. */
    charactersSettled: characters.isFetched,
    projects: useMemo(
      () =>
        (projects.data?.projects ?? [])
          .map((p) => ({ id: p.id, name: p.name || 'Untitled project' }))
          .sort(byName),
      [projects.data],
    ),
    groups: useMemo(
      () =>
        (groups.data?.groups ?? [])
          .map((g) => ({ id: g.id, name: g.name || 'Untitled group' }))
          .sort(byName),
      [groups.data],
    ),
  }
}

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

/**
 * Renders the wardrobe body inside the floating `BaseModal` (dialog) or bare in
 * a scrollable container (workspace tab). Keeps the wardrobe logic in one place.
 */
function WardrobeShell({
  asTab,
  onClose,
  footer,
  closeOnClickOutside,
  closeOnEscape,
  children,
}: {
  asTab?: boolean
  onClose: () => void
  footer: React.ReactNode
  closeOnClickOutside: boolean
  closeOnEscape: boolean
  children: React.ReactNode
}) {
  if (asTab) {
    return (
      <div className="qt-wardrobe-tab flex flex-col h-full min-h-0 overflow-y-auto p-4">
        {children}
      </div>
    )
  }
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Wardrobe"
      maxWidth="4xl"
      showCloseButton
      closeOnClickOutside={closeOnClickOutside}
      closeOnEscape={closeOnEscape}
      footer={footer}
    >
      {children}
    </BaseModal>
  )
}

function WardrobeControlDialogInner({
  initialCharacterId,
  chatId,
  onClose,
  asTab = false,
}: InnerProps) {
  const isInChat = chatId !== null
  const catalogue = useWardrobeCatalogue()

  // Which wardrobe is being browsed: a character's merged view, or one shared
  // container (Quilltap General, a project, a group) edited in place. With
  // nothing chosen, the first character — or General on a characterless
  // instance — once the character list has settled.
  const [chosenContainer, setChosenContainer] = useState<WardrobeContainer | null>(
    initialCharacterId ? { scope: 'character', id: initialCharacterId } : null,
  )
  const firstCharacterId = catalogue.characters[0]?.id ?? null
  const selectedContainer = useMemo<WardrobeContainer | null>(
    () =>
      chosenContainer ??
      (catalogue.charactersSettled
        ? firstCharacterId
          ? { scope: 'character', id: firstCharacterId }
          : GENERAL_CONTAINER
        : null),
    [chosenContainer, catalogue.charactersSettled, firstCharacterId],
  )
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

  // True while an imperative confirmation dialog is up. That dialog renders
  // into document.body (outside this modal), so a click on its buttons would
  // otherwise read as a click outside the wardrobe and close it the instant
  // you confirm. Every confirmation goes through `requestConfirmation`.
  const [confirming, setConfirming] = useState(false)
  const requestConfirmation = useCallback(async (message: string): Promise<boolean> => {
    setConfirming(true)
    try {
      return await showConfirmation(message)
    } finally {
      setConfirming(false)
    }
  }, [])

  const actions = useWardrobeItemActions({
    container: selectedContainer,
    chatId,
    listItems: data.listItems,
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
  const [resetMenuOpen, setResetMenuOpen] = useState(false)
  const resetMenuRef = useRef<HTMLDivElement>(null)
  const closeResetMenu = useCallback(() => setResetMenuOpen(false), [])
  useClickOutside(resetMenuRef, closeResetMenu, {
    enabled: resetMenuOpen,
    onEscape: closeResetMenu,
    escapeCapture: true,
  })
  const [importFromImageOpen, setImportFromImageOpen] = useState(false)

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

  /** Display name of the browsed container, for the editor's pinned note. */
  const selectedContainerLabel = useMemo(() => {
    if (!selectedContainer) return ''
    switch (selectedContainer.scope) {
      case 'character':
        return selectedCharacter?.name ?? ''
      case 'general':
        return GENERAL_WARDROBE_NAME
      case 'project':
        return catalogue.projects.find((p) => p.id === selectedContainer.id)?.name ?? 'This project'
      case 'group':
        return catalogue.groups.find((g) => g.id === selectedContainer.id)?.name ?? 'This group'
    }
  }, [selectedContainer, selectedCharacter, catalogue.projects, catalogue.groups])

  // While an overlay is up, a click inside it (rendered as a sibling) must not
  // close the outer dialog via BaseModal's click-outside handler.
  const overlayOpen = actions.overlayOpen || importFromImageOpen

  return (
    <>
      <WardrobeShell
        asTab={asTab}
        onClose={requestClose}
        closeOnClickOutside={!overlayOpen && !confirming}
        closeOnEscape={!overlayOpen && !confirming}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={requestClose} className="qt-button-secondary qt-button-sm">
              Done
            </button>
          </div>
        }
      >
        {/* Container selector — every place a wardrobe item can live gets an
            entry: characters, Quilltap General, projects, and groups. */}
        <div className="flex flex-col gap-3 mb-3">
          <div className="flex items-center gap-2">
            <label htmlFor="wardrobe-container-select" className="text-sm qt-text-secondary">
              Wardrobe:
            </label>
            {selectedCharacter?.avatarUrl && (
              <img
                src={selectedCharacter.avatarUrl}
                alt=""
                className="w-6 h-6 rounded-full object-cover qt-bg-muted border qt-border-default flex-shrink-0"
              />
            )}
            <select
              id="wardrobe-container-select"
              className="qt-select flex-1 max-w-md"
              value={selectedContainer ? encodeWardrobeContainer(selectedContainer) : ''}
              onChange={(e) => setChosenContainer(decodeWardrobeContainer(e.target.value))}
            >
              {!selectedContainer && (
                <option value="" disabled>
                  Select a wardrobe
                </option>
              )}
              {catalogue.characters.length > 0 && (
                <optgroup label="Characters">
                  {catalogue.characters.map((c) => (
                    <option key={c.id} value={encodeWardrobeContainer({ scope: 'character', id: c.id })}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="General">
                <option value={encodeWardrobeContainer(GENERAL_CONTAINER)}>{GENERAL_WARDROBE_NAME}</option>
              </optgroup>
              {catalogue.projects.length > 0 && (
                <optgroup label="Projects">
                  {catalogue.projects.map((p) => (
                    <option key={p.id} value={encodeWardrobeContainer({ scope: 'project', id: p.id })}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {catalogue.groups.length > 0 && (
                <optgroup label="Groups">
                  {catalogue.groups.map((g) => (
                    <option key={g.id} value={encodeWardrobeContainer({ scope: 'group', id: g.id })}>
                      {g.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {!isCharacterScope && selectedContainer && (
            <p className="qt-text-xs qt-text-secondary px-1">
              Browsing a shared wardrobe — items here can be worn by every character who can
              reach this {selectedContainer.scope === 'general' ? 'library' : selectedContainer.scope}.
              Edit, duplicate, or delete them freely; pick a character above to dress someone.
            </p>
          )}
        </div>

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
          />

          {/* RIGHT: Live outfit / Outfit Builder — Builder always present;
              Live outfit only when there's a chat to mutate against. */}
          {selectedCharacterId && (
            <section className="flex flex-col min-h-0">
              <div className="flex items-center gap-1 mb-2 qt-tab-group">
                {isInChat && (
                  <button
                    type="button"
                    onClick={() => setRightTab('live')}
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
                  className={`qt-tab ${rightTab === 'builder' ? 'qt-tab-active' : ''}`}
                >
                  Outfit Builder
                </button>
              </div>

              {rightTab === 'live' && isInChat ? (
                <div className="space-y-2 mb-3">
                  <p className="qt-text-xs qt-text-secondary px-1">
                    Edits stage here and apply when you click Done. Nothing happens until then.
                  </p>
                  <OutfitComposer items={items} slots={live.displaySlots} {...liveHandlers} />
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
                    <div className="relative" ref={resetMenuRef}>
                      <button
                        type="button"
                        onClick={() => setResetMenuOpen((v) => !v)}
                        className="qt-button-ghost qt-button-sm"
                        aria-haspopup="menu"
                        aria-expanded={resetMenuOpen}
                        title="Reset the staged composition"
                      >
                        Reset…
                      </button>
                      {resetMenuOpen && (
                        <div
                          role="menu"
                          className="absolute left-0 top-full mt-1 z-30 min-w-[14rem] rounded border qt-border-default qt-bg-default shadow-md"
                        >
                          <ul className="divide-y qt-border-default">
                            {isInChat && (
                              <li>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setResetMenuOpen(false)
                                    void fitting.resetToWorn()
                                  }}
                                  className="block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted"
                                >
                                  Reset to worn
                                </button>
                              </li>
                            )}
                            <li>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setResetMenuOpen(false)
                                  void fitting.resetToDefaults()
                                }}
                                className="block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted"
                              >
                                Reset to defaults
                              </button>
                            </li>
                            <li>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setResetMenuOpen(false)
                                  void fitting.clearAll()
                                }}
                                className="block w-full text-left px-3 py-2 text-sm qt-text-secondary hover:qt-bg-muted"
                              >
                                Clear all
                              </button>
                            </li>
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                  <OutfitComposer items={items} slots={fitting.slots} {...fittingHandlers} />
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
      </WardrobeShell>

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

      <WardrobeItemOverlays
        container={selectedContainer}
        containerLabel={selectedContainerLabel}
        data={data}
        actions={actions}
      />
    </>
  )
}
