'use client'

/**
 * Light costume — navigate + select, NO mutation.
 *
 * The same SVAR `<Filemanager>` as the heavy costume, but `readonly` (no
 * create/rename/move/delete) and wired only to report the current selection.
 * This is the reusable building block for the attach-a-file picker and the
 * folder picker; the host (a modal) supplies the mount + a Select/confirm
 * affordance and acts on `onPick`.
 *
 * Reuses `loadMountTree` (and the promoted theme bridge) — no adapter mutation
 * wiring, since a picker never writes. Selection is read via the api event bus
 * (`api.on('select-file')` — the canonical action name) rather than a prop, to
 * match the adapter pattern and avoid SVAR prop-name casing ambiguity.
 * `select` constrains what counts as a valid pick.
 *
 * @module components/files/svar/SvarFilePicker
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Filemanager, Willow } from '@svar-ui/react-filemanager'
import '@svar-ui/react-filemanager/all.css'
import './svar-theme-bridge.css'
import type { IApi, IEntity } from './svar-types'
import { loadMountTree, wirePickerSelection } from './createSvarAdapter'
import type { PickerSelection } from './createSvarAdapter'

export type PickedItem = PickerSelection

export interface SvarFilePickerProps {
  mountId: string
  /** Which kind of node is a valid pick. Default: any. */
  select?: 'file' | 'folder' | 'any'
  /** Fires with the current valid selection, or null when it's cleared/invalid. */
  onPick: (item: PickedItem | null) => void
  /** Optional fixed height for the browser pane. */
  height?: string
}

export function SvarFilePicker({ mountId, select = 'any', onPick, height = '60vh' }: SvarFilePickerProps) {
  const [data, setData] = useState<IEntity[] | null>(null)
  const apiRef = useRef<IApi | null>(null)

  useEffect(() => {
    let live = true
    loadMountTree(mountId)
      .then((tree) => { if (live) setData(tree) })
      .catch(() => { if (live) setData([]) })
    return () => { live = false }
  }, [mountId])

  const init = useCallback(
    (api: IApi) => {
      apiRef.current = api
      wirePickerSelection(api, { select, onPick })
    },
    [select, onPick]
  )

  if (data === null) {
    return <div className="qt-section-title p-4">Opening the repository…</div>
  }

  return (
    <Willow>
      <div style={{ height }}>
        <Filemanager data={data} readonly init={init} />
      </div>
    </Willow>
  )
}

export default SvarFilePicker
