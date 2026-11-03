'use client'

/**
 * "Move to folder…" / "Copy to folder…" for a tiered item browser — the
 * wardrobe's and the Inventory's: pick where in the items' own tier to file
 * them (or copies of them), file them, and say where they went.
 *
 * The picker is the shared `DestinationPickerDialog`; the kind's folders hook
 * and folder creator come in as a port and the filing call as `file`, so this file
 * holds what both kinds do the same — the subject line, the folder every item
 * already shares (disabled for a move), the busy state, the toast — and the
 * kind supplies its wording. A kind with one more question (the wardrobe's
 * outfit components) passes it as a `choice`: the picker keeps its value and
 * hands it to `file` alongside the folder. Filing never changes what anyone
 * can wear or carry.
 *
 * @module components/item-browser/ItemFolderPickerDialog
 */

import { useState, type ReactNode } from 'react'
import { folderCrumb, isSameFolder } from '@/lib/mount-index/item-folders'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { DestinationPickerDialog } from './DestinationPickerDialog'
import type { ItemContainer } from './ItemControlDialogShell'

/** What the picker needs from a row: enough to name it and find its folder. */
export interface FileableItem {
  id: string
  title?: string | null
  name?: string | null
  folder?: string | null
}

/** The wording that makes the picker a kind's own. */
export interface ItemFolderPickerWording {
  /** The root row, e.g. `Wardrobe (top level)`. */
  rootLabel: string
  /** The noun for a count, e.g. `item` → `3 items`. */
  noun: string
  /** Where the root is, e.g. `the top of the wardrobe`. */
  rootPhrase: string
  /** How a filed thing rests, singular and plural: `hangs` / `hang`. */
  rests: [string, string]
  moveNote: string
  copyNote: string
  /** The toast for a refusal. */
  describeError: (error: unknown, fallback: string) => string
}

/** One more question the kind asks (the wardrobe's outfit components). */
export interface ItemFolderPickerChoice<C> {
  initial: C
  render: (value: C, onChange: (next: C) => void, working: boolean) => ReactNode
}

/** A kind's folder reads and folder creation, against a tier named per call. */
export interface ItemFolderPort {
  /** The kind's folders hook (stable: a module-level hook, never inline). */
  useFolders: (container: ItemContainer | null) => { folders: ReadonlyArray<{ path: string }>; loading: boolean }
  createFolder: (container: ItemContainer, path: string) => Promise<{ path: string }>
  creating: boolean
}

export interface ItemFolderPickerDialogProps<T extends FileableItem, C> {
  mode: 'move' | 'copy'
  items: readonly T[]
  /** The tier the items live in — the only one whose folders are offered. */
  container: ItemContainer
  port: ItemFolderPort
  /** File the items; answers the filed rows (their folder names the toast). */
  file: (folder: string, choice: C | undefined) => Promise<ReadonlyArray<{ folder?: string | null }>>
  wording: ItemFolderPickerWording
  choice?: ItemFolderPickerChoice<C>
  onClose: () => void
  /** After a successful filing, before the picker closes (leave select mode). */
  onFiled?: () => void
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function ItemFolderPickerDialog<T extends FileableItem, C = never>({
  mode,
  items,
  container,
  port,
  file,
  wording,
  choice,
  onClose,
  onFiled,
}: ItemFolderPickerDialogProps<T, C>) {
  const { folders, loading } = port.useFolders(container)
  const [working, setWorking] = useState(false)
  const [choiceValue, setChoiceValue] = useState<C | undefined>(choice?.initial)

  const first = items[0]?.folder ?? ''
  const currentFolder = items.every((i) => isSameFolder(i.folder ?? '', first)) ? first : null
  const one = items.length === 1
  const subject = one ? `"${items[0].title || items[0].name || ''}"` : plural(items.length, wording.noun)

  const submit = async (folder: string): Promise<void> => {
    const copying = mode === 'copy'
    setWorking(true)
    try {
      const filed = await file(folder, choice ? choiceValue : undefined)
      const where = folder ? `"${folderCrumb(filed[0]?.folder || folder)}"` : wording.rootPhrase
      const rests = wording.rests[one ? 0 : 1]
      showSuccessToast(
        copying ? `${one ? 'A copy' : 'Copies'} of ${subject} now ${rests} in ${where}` : `${subject} now ${rests} in ${where}`,
      )
      onFiled?.()
      onClose()
    } catch (error) {
      const noun = `${wording.noun}s`
      showErrorToast(wording.describeError(error, `The ${noun} would not be ${copying ? 'copied' : 'moved'}`))
    } finally {
      setWorking(false)
    }
  }

  return (
    <DestinationPickerDialog
      isOpen
      mode={mode}
      subject={subject}
      folders={folders}
      loading={loading}
      rootLabel={wording.rootLabel}
      onCreateFolder={(path) => port.createFolder(container, path)}
      creating={port.creating}
      currentFolder={currentFolder}
      working={working}
      note={mode === 'copy' ? wording.copyNote : wording.moveNote}
      onClose={onClose}
      onSubmit={submit}
    >
      {choice && choiceValue !== undefined && (
        <div className="mt-3">{choice.render(choiceValue, setChoiceValue, working)}</div>
      )}
    </DestinationPickerDialog>
  )
}
