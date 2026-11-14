'use client';

/**
 * The Salon's per-participant actions, provided once by `SalonView` and read
 * by the chat sidebar's participant list.
 *
 * These thirteen used to be props threaded from `SalonView` through
 * `ChatSidebar` and `ParticipantsSection` to every `ParticipantCard`, untouched
 * at each level. The sidebar's own props now carry only what the sidebar
 * itself reads.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { ConnectionProfileOption } from '@/components/chat/ParticipantCard';

export interface ChatActions {
  onNudge: (participantId: string) => void;
  onQueue: (participantId: string) => void;
  onDequeue: (participantId: string) => void;
  onTalkativenessChange?: (participantId: string, value: number) => void;
  onRemoveCharacter?: (participantId: string) => void;
  onImpersonate?: (participantId: string) => void;
  onStopImpersonate?: (participantId: string) => void;
  connectionProfiles?: ConnectionProfileOption[];
  onConnectionProfileChange?: (participantId: string, profileId: string | null, controlledBy: 'llm' | 'user') => void;
  onSystemPromptChange?: (participantId: string, promptId: string | null) => void;
  onSubpromptsChange?: (participantId: string, subpromptIds: string[]) => void;
  onRebuildSystemPrompt?: (participantId: string) => void;
  onRegenerateAvatar?: (participantId: string) => void;
}

const ChatActionsContext = createContext<ChatActions | null>(null);

export function ChatActionsProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ChatActions;
}) {
  return <ChatActionsContext.Provider value={value}>{children}</ChatActionsContext.Provider>;
}

/** The participant actions. Throws outside a `ChatActionsProvider`. */
export function useChatActions(): ChatActions {
  const context = useContext(ChatActionsContext);
  if (!context) {
    throw new Error('useChatActions must be used within ChatActionsProvider');
  }
  return context;
}
