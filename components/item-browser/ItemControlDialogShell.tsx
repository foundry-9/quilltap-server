'use client'

/**
 * The frame both tiered control dialogs share — the Wardrobe's and the
 * Inventory's — stated once:
 *
 *  - {@link useItemControlState}: which container is browsed (the opener's,
 *    else the first character once the catalogue settles, else Quilltap
 *    General), its display label, and the confirmation / alert wrappers that
 *    keep the dialog open while an imperative prompt (rendered into
 *    `document.body`, outside the modal) is answered.
 *  - {@link ItemControlDialogShell}: the container `<select>` header with the
 *    "shared with every character who can reach this …" note, and the
 *    modal-or-tab shell — a floating `BaseModal` with a Done footer, or bare
 *    in a scrolling workspace tab. Overlays (editors, pickers) render as
 *    siblings, so a click inside one is never a click outside the dialog.
 *
 * What each kind keeps is its body: the Wardrobe's outfit columns, the
 * Inventory's *Carrying now* pane.
 *
 * @module components/item-browser/ItemControlDialogShell
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { showAlert, showConfirmation } from '@/lib/alert'
import {
  GENERAL_CONTAINER,
  GENERAL_WARDROBE_NAME,
  decodeWardrobeContainer,
  encodeWardrobeContainer,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import { useContainerCatalogue, type ContainerCatalogue } from '@/lib/hooks/use-container-catalogue'
import { ContainerSelect } from './ContainerSelect'

/** The two tiered item browsers. */
export type ItemControlKind = 'wardrobe' | 'inventory'

/** A tier an item can live in; the Wardrobe and the Inventory share the shape. */
export type ItemContainer = WardrobeContainer

interface KindCopy {
  title: string
  selectLabel: string
  placeholder: string
  tabClass: string
  /** The browsed container's label when it is a character's. */
  characterLabel: (name: string | null) => string
  project: string
  group: string
  /** The note under the select for a shared (non-character) container. */
  sharedNote: (reach: string) => string
}

const KIND_COPY: Record<ItemControlKind, KindCopy> = {
  wardrobe: {
    title: 'Wardrobe',
    selectLabel: 'Wardrobe:',
    placeholder: 'Select a wardrobe',
    tabClass: 'qt-wardrobe-tab',
    characterLabel: (name) => name ?? '',
    project: 'This project',
    group: 'This group',
    sharedNote: (reach) =>
      `Browsing a shared wardrobe — items here can be worn by every character who can reach this ${reach}. ` +
      'Edit, duplicate, or delete them freely; pick a character above to dress someone.',
  },
  inventory: {
    title: 'Inventory',
    selectLabel: 'Inventory:',
    placeholder: 'Select an inventory',
    tabClass: 'qt-inventory-tab',
    characterLabel: (name) => `${name ?? 'this character'}'s inventory`,
    project: 'this project',
    group: 'this group',
    sharedNote: (reach) =>
      `A shared inventory — every character who can reach this ${reach} can carry what is here, ` +
      'and its archetypes can be instantiated by any of them.',
  },
}

/** The display name of a container, as an editor's "kept in" note spells it. */
export function itemContainerLabel(
  kind: ItemControlKind,
  container: ItemContainer | null,
  catalogue: Pick<ContainerCatalogue, 'characters' | 'projects' | 'groups'>,
): string {
  if (!container) return ''
  const copy = KIND_COPY[kind]
  switch (container.scope) {
    case 'character':
      return copy.characterLabel(catalogue.characters.find((c) => c.id === container.id)?.name ?? null)
    case 'general':
      return GENERAL_WARDROBE_NAME
    case 'project':
      return catalogue.projects.find((p) => p.id === container.id)?.name ?? copy.project
    case 'group':
      return catalogue.groups.find((g) => g.id === container.id)?.name ?? copy.group
  }
}

export interface ItemControlState {
  catalogue: ContainerCatalogue
  /** The browsed container; null until the character list settles. */
  container: ItemContainer | null
  setContainer: (container: ItemContainer | null) => void
  containerLabel: string
  /** True while a confirmation or alert is up (the dialog must not close). */
  confirming: boolean
  requestConfirmation: (message: string) => Promise<boolean>
  requestAlert: (message: string, buttons?: string[]) => Promise<string | undefined>
}

/**
 * The browsed container and the prompt wrappers. With nothing chosen, the
 * first character — or General on a characterless instance — once the
 * character list has settled.
 */
export function useItemControlState(kind: ItemControlKind, initial: ItemContainer | null): ItemControlState {
  const catalogue = useContainerCatalogue()
  const [chosen, setChosen] = useState<ItemContainer | null>(initial)
  const firstCharacterId = catalogue.characters[0]?.id ?? null
  const container = useMemo<ItemContainer | null>(
    () =>
      chosen ??
      (catalogue.charactersSettled
        ? firstCharacterId
          ? { scope: 'character', id: firstCharacterId }
          : GENERAL_CONTAINER
        : null),
    [chosen, catalogue.charactersSettled, firstCharacterId],
  )

  // Every confirmation and alert goes through these: the prompt renders into
  // document.body (outside the modal), so a click on its buttons would
  // otherwise read as a click outside the dialog and close it.
  const [confirming, setConfirming] = useState(false)
  const requestConfirmation = useCallback(async (message: string): Promise<boolean> => {
    setConfirming(true)
    try {
      return await showConfirmation(message)
    } finally {
      setConfirming(false)
    }
  }, [])
  const requestAlert = useCallback(async (message: string, buttons?: string[]) => {
    setConfirming(true)
    try {
      return await showAlert(message, buttons)
    } finally {
      setConfirming(false)
    }
  }, [])

  const containerLabel = useMemo(() => itemContainerLabel(kind, container, catalogue), [kind, container, catalogue])

  return { catalogue, container, setContainer: setChosen, containerLabel, confirming, requestConfirmation, requestAlert }
}

export interface ItemControlDialogShellProps {
  kind: ItemControlKind
  state: ItemControlState
  /** Render bare for a workspace tab instead of inside the floating modal. */
  asTab?: boolean
  /** Hide the container select (a card pinned to one tier). */
  fixedContainer?: boolean
  /** Done, the close button, Escape and an outside click. */
  onClose: () => void
  /** An editor or picker is up: the dialog must not close under it. */
  overlayOpen?: boolean
  /** Shown before the select (the Wardrobe's character avatar). */
  selectAdornment?: ReactNode
  /** Editors and pickers, rendered beside the dialog rather than inside it. */
  overlays?: ReactNode
  children: ReactNode
}

export function ItemControlDialogShell({
  kind,
  state,
  asTab = false,
  fixedContainer = false,
  onClose,
  overlayOpen = false,
  selectAdornment,
  overlays,
  children,
}: ItemControlDialogShellProps) {
  const copy = KIND_COPY[kind]
  const { container, catalogue } = state
  const selectId = `${kind}-container-select`

  const body = (
    <>
      {!fixedContainer && (
        <div className="flex flex-col gap-3 mb-3">
          <div className="flex items-center gap-2">
            <label htmlFor={selectId} className="text-sm qt-text-secondary">
              {copy.selectLabel}
            </label>
            {selectAdornment}
            <ContainerSelect
              id={selectId}
              className="qt-select flex-1 max-w-md"
              value={container ? encodeWardrobeContainer(container) : ''}
              onChange={(key) => state.setContainer(decodeWardrobeContainer(key))}
              catalogue={catalogue}
              generalName={GENERAL_WARDROBE_NAME}
              placeholder={copy.placeholder}
            />
          </div>
          {container && container.scope !== 'character' && (
            <p className="qt-text-xs qt-text-secondary px-1">
              {copy.sharedNote(container.scope === 'general' ? 'library' : container.scope)}
            </p>
          )}
        </div>
      )}
      {children}
    </>
  )

  if (asTab) {
    return (
      <>
        <div
          className={
            fixedContainer
              ? 'flex flex-col min-h-0'
              : `${copy.tabClass} flex flex-col h-full min-h-0 overflow-y-auto p-4`
          }
        >
          {body}
        </div>
        {overlays}
      </>
    )
  }

  const locked = overlayOpen || state.confirming
  return (
    <>
      <BaseModal
        isOpen
        onClose={onClose}
        title={copy.title}
        maxWidth="4xl"
        showCloseButton
        closeOnClickOutside={!locked}
        closeOnEscape={!locked}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={onClose} className="qt-button-secondary qt-button-sm">
              Done
            </button>
          </div>
        }
      >
        {body}
      </BaseModal>
      {overlays}
    </>
  )
}
