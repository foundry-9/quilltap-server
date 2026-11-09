'use client'

/**
 * The New Chat dialog's one source of data: a context fed by
 * {@link useNewChat}, read by the form, the character picker, the dialog
 * frame and the full-page fallback — so no surface threads the form's props
 * by hand.
 *
 * Design of record: docs/developer/features/refactor-green-room-and-opening.md (D9)
 *
 * @module components/new-chat/NewChatFormContext
 */

import { createContext, useContext, type ReactNode } from 'react'
import { useNewChat, type UseNewChatOptions, type UseNewChatReturn } from './hooks/useNewChat'

export type NewChatFormContextValue = UseNewChatReturn

/** Exported so tests can supply a value directly. */
export const NewChatFormContext = createContext<NewChatFormContextValue | null>(null)

/** Runs {@link useNewChat} once and shares it with everything beneath. */
export function NewChatFormProvider({ options, children }: { options: UseNewChatOptions; children: ReactNode }) {
  const value = useNewChat(options)
  return <NewChatFormContext.Provider value={value}>{children}</NewChatFormContext.Provider>
}

/** The New Chat form's data; throws outside a {@link NewChatFormProvider}. */
export function useNewChatForm(): NewChatFormContextValue {
  const value = useContext(NewChatFormContext)
  if (!value) throw new Error('useNewChatForm must be used inside a NewChatFormProvider')
  return value
}
