'use client'

import { createContext, useContext } from 'react'
import type { QtapUriParts } from '@/lib/doc-edit/qtap-uri'

export type QtapTargetKind = 'document' | 'image' | 'other'

export interface QtapTargetResolution {
  exists: boolean
  kind: QtapTargetKind
}

/** Where a link is rendered: its workspace tab (null outside the workspace). */
export interface QtapLinkOrigin {
  tabId: string | null
}

export interface QtapLinkOpener {
  resolve: (parts: QtapUriParts, origin?: QtapLinkOrigin) => Promise<QtapTargetResolution>
  open: (parts: QtapUriParts, resolution: QtapTargetResolution, href: string, origin?: QtapLinkOrigin) => void
}

export const QtapLinkContext = createContext<QtapLinkOpener | null>(null)

export function useQtapLink(): QtapLinkOpener | null {
  return useContext(QtapLinkContext)
}