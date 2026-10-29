'use client'

/**
 * BrahmaConsoleView — the Brahma Console as a workspace tab (singleton).
 *
 * Renders the shared {@link BrahmaConsolePanel} bare, with an inline header for
 * its chrome. The tab keeps its own {@link useBrahmaConsoleSession}, separate
 * from the always-on floating dialog's, so both can be open on different
 * conversations at once.
 *
 * @module components/brahma-console/BrahmaConsoleView
 */

import { BrahmaConsolePanel } from './BrahmaConsolePanel'
import { useBrahmaConsoleSession } from './hooks/useBrahmaConsoleSession'

const STORAGE_KEY_TAB_LAST_CHAT = 'quilltap:brahma-console-last-id'

export function BrahmaConsoleView() {
  const session = useBrahmaConsoleSession(STORAGE_KEY_TAB_LAST_CHAT)

  return (
    <BrahmaConsolePanel session={session} active>
      {({ headerActions, body }) => (
        <div className="flex flex-col h-full min-h-0">
          {headerActions && (
            <div className="flex items-center justify-end gap-1 px-3 py-2 border-b qt-border-default/60">
              {headerActions}
            </div>
          )}
          {body}
        </div>
      )}
    </BrahmaConsolePanel>
  )
}
