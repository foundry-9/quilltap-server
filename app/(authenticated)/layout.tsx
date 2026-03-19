/**
 * Authenticated Layout (Single-User Mode)
 *
 * In single-user mode, wraps children with the HelpChatProvider
 * for help chat state management across authenticated pages.
 */

import { HelpChatProvider } from '@/components/providers/help-chat-provider'
import { HelpChatDialog } from '@/components/help-chat/HelpChatDialog'

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <HelpChatProvider>
      {children}
      <HelpChatDialog />
    </HelpChatProvider>
  );
}
