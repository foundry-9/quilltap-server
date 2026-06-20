'use client'

import { createContext, useContext } from 'react'
import type { QtapUriParts } from '@/lib/doc-edit/qtap-uri'

/**
 * Bridge that lets a `qtap://` link rendered deep inside a message (in the pure
 * `MessageContent` renderer) reach the Salon's chat-scoped Document-Mode
 * actions. Provided once at the Salon page, consumed by `QtapDocLink`.
 */
export interface QtapDocOpener {
  /**
   * True iff the target resolves to an existing, accessible document for this
   * chat. The provider caches by (scope, mountPoint, path) so several links to
   * the same target share one request.
   */
  checkExists: (parts: QtapUriParts) => Promise<boolean>
  /** Open the document in Document Mode (split view). */
  open: (parts: QtapUriParts) => void
}

export const QtapDocContext = createContext<QtapDocOpener | null>(null)

/** Consume the Document-Mode bridge; null when rendered outside the Salon. */
export function useQtapDoc(): QtapDocOpener | null {
  return useContext(QtapDocContext)
}
