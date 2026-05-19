'use client'

/**
 * Wardrobe Dialog Provider
 *
 * Hosts the global "Wardrobe Control" dialog. Any component inside the
 * authenticated layout can summon the dialog via `useWardrobeDialog().open()`,
 * passing optional `characterId` / `chatId` context.
 *
 * Mirrors the HelpChatProvider pattern so the dialog can live once at the
 * layout level and be opened from the left sidebar, the participant cards,
 * the Aurora character page, etc.
 *
 * @module components/providers/wardrobe-dialog-provider
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

/**
 * Shape of the optional context passed to `open()` so the dialog can preselect
 * a character and surface chat-scoped controls when invoked from the Salon.
 */
export interface WardrobeDialogContext {
  /** Preselect this character in the dialog header dropdown. */
  characterId?: string
  /** When set, the dialog renders the "wearing now" column for this chat. */
  chatId?: string
}

interface WardrobeDialogContextValue {
  isOpen: boolean
  context: WardrobeDialogContext | null
  open: (ctx?: WardrobeDialogContext) => void
  close: () => void
}

const WardrobeDialogCtx = createContext<WardrobeDialogContextValue | null>(null)

export function WardrobeDialogProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [context, setContext] = useState<WardrobeDialogContext | null>(null)

  const open = useCallback((ctx?: WardrobeDialogContext) => {
    setContext(ctx ?? null)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <WardrobeDialogCtx.Provider value={{ isOpen, context, open, close }}>
      {children}
    </WardrobeDialogCtx.Provider>
  )
}

/**
 * Hook to access the wardrobe dialog. Throws if used outside the provider.
 */
export function useWardrobeDialog(): WardrobeDialogContextValue {
  const v = useContext(WardrobeDialogCtx)
  if (!v) throw new Error('useWardrobeDialog must be used inside WardrobeDialogProvider')
  return v
}

/**
 * Optional variant for components that may render outside the provider tree
 * (e.g. unauthenticated pages). Returns null instead of throwing.
 */
export function useWardrobeDialogOptional(): WardrobeDialogContextValue | null {
  return useContext(WardrobeDialogCtx)
}
