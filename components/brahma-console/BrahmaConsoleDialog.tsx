'use client'

/**
 * BrahmaConsoleDialog
 *
 * The always-on floating Brahma Console: the shared {@link BrahmaConsolePanel}
 * inside a topmost {@link FloatingDialog}. It is toggled by the
 * {@link BrahmaConsoleLauncher} button and sits above every portal modal, so
 * the operator can consult the engine in the middle of filling out a form.
 *
 * The component stays mounted for the life of the authenticated layout, so its
 * session (and any reply still streaming) survives the dialog being hidden;
 * reopening it returns to the same conversation.
 *
 * @module components/brahma-console/BrahmaConsoleDialog
 */

import { FloatingDialog } from '@/components/ui/FloatingDialog'
import { useBrahmaConsole } from '@/components/providers/brahma-console-provider'
import { BrahmaConsolePanel } from './BrahmaConsolePanel'
import { useBrahmaConsoleSession } from './hooks/useBrahmaConsoleSession'

const STORAGE_KEY_FLOATING_LAST_CHAT = 'quilltap:brahma-floating-last-id'

export function BrahmaConsoleDialog() {
  const { isOpen, closeConsole } = useBrahmaConsole()
  const session = useBrahmaConsoleSession(STORAGE_KEY_FLOATING_LAST_CHAT)

  return (
    <BrahmaConsolePanel session={session} active={isOpen}>
      {({ headerActions, body }) => (
        <FloatingDialog
          isOpen={isOpen}
          onClose={closeConsole}
          title="Brahma Console"
          minWidth={480}
          minHeight={400}
          initialGeometry={{ width: 560 }}
          storageKey="quilltap:brahma-console-geometry"
          headerActions={headerActions}
          topmost
        >
          {body}
        </FloatingDialog>
      )}
    </BrahmaConsolePanel>
  )
}
