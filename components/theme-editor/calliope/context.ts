'use client'

/**
 * Calliope's hand-off within one open draft: any part of the editor (an issue,
 * a token row's contrast line) may open her panel with a message begun. Null
 * outside a draft editor, where nothing offers to ask her.
 *
 * @module components/theme-editor/calliope/context
 */

import { createContext, useContext } from 'react'

export interface CalliopeHandOff {
  /** Open her panel with `text` in the composer, for the author to finish and send. */
  ask: (text: string) => void
}

export const CalliopeHandOffContext = createContext<CalliopeHandOff | null>(null)

export function useCalliopeHandOff(): CalliopeHandOff | null {
  return useContext(CalliopeHandOffContext)
}
