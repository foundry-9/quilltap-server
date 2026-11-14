'use client'

/**
 * NewChatProvider — opens the new-chat experience as an app-level modal so the
 * "Start a chat" entry points don't navigate to the full-page `/salon/new`
 * route (which, inside the workspace, would remount everything and tear down a
 * streaming Salon). It is mounted INSIDE the workspace providers so the modal's
 * `useNewChat` → `useWorkspaceNavigate` opens the new chat as a tab in place.
 *
 * `open(opts)` is the only way the dialog appears: the
 * {@link WorkspaceLinkInterceptor} calls it for `/salon/new` links (including
 * autonomous-room creation, `?autonomous=1`), and the character page, the
 * homepage card and the Salon's Continue Elsewhere call it directly. Closing
 * the dialog just unmounts it, so the operator stays wherever they opened it.
 * Outside the workspace, callers fall back to the `/salon/new` page.
 *
 * @module components/providers/new-chat-provider
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { NewChatModal } from '@/components/new-chat/NewChatModal'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import type { TimestampConfig } from '@/lib/schemas/types'

export interface NewChatModalOptions {
  characterId?: string
  characterName?: string
  projectId?: string
  continuationFromChatId?: string
  initialSelectedCharacterIds?: string[]
  initialUserCharacterId?: string | null
  initialImageProfileId?: string | null
  initialAvatarGenerationEnabled?: boolean
  /** Timestamp config to pre-fill (continuation mode). */
  initialTimestampConfig?: TimestampConfig | null
  /** Concierge state to pre-fill (continuation mode). */
  initialConciergeState?: ConciergeState | null
  /** Open in autonomous-room creation mode. */
  autonomous?: boolean
}

interface NewChatContextValue {
  open: (opts?: NewChatModalOptions) => void
}

const NewChatContext = createContext<NewChatContextValue | null>(null)

export function NewChatProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<NewChatModalOptions | null>(null)

  const open = useCallback((next: NewChatModalOptions = {}) => setOpts(next), [])
  const close = useCallback(() => setOpts(null), [])

  const value = useMemo<NewChatContextValue>(() => ({ open }), [open])

  return (
    <NewChatContext.Provider value={value}>
      {children}
      {opts && (
        <NewChatModal
          onClose={close}
          characterId={opts.characterId}
          characterName={opts.characterName}
          projectId={opts.projectId}
          continuationFromChatId={opts.continuationFromChatId}
          initialSelectedCharacterIds={opts.initialSelectedCharacterIds}
          initialUserCharacterId={opts.initialUserCharacterId}
          initialImageProfileId={opts.initialImageProfileId}
          initialAvatarGenerationEnabled={opts.initialAvatarGenerationEnabled}
          initialTimestampConfig={opts.initialTimestampConfig}
          initialConciergeState={opts.initialConciergeState}
          autonomous={opts.autonomous}
        />
      )}
    </NewChatContext.Provider>
  )
}

/** Returns the new-chat modal controller, or null outside the provider. */
export function useNewChatModalOptional(): NewChatContextValue | null {
  return useContext(NewChatContext)
}
