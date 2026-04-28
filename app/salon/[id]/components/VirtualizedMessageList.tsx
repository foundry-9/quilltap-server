'use client'

import type { Virtualizer } from '@tanstack/react-virtual'
import ToolMessage from '@/components/chat/ToolMessage'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import type { TurnState } from '@/lib/chat/turn-manager'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'
import type { Message, CharacterData, ChatSettings } from '../types'
import type { SwipeState } from '../hooks/useChatData'
import { MessageRow } from './MessageRow'
import { PendingToolCalls } from './PendingToolCalls'
import { EphemeralMessages as EphemeralMessagesComponent } from './EphemeralMessages'
import { StreamingMessage } from './StreamingMessage'
import type { PendingToolCall } from '../hooks/useSSEStreaming'
import type { EphemeralMessageData } from '@/components/chat/EphemeralMessage'

interface VirtualizedMessageListProps {
  messages: Message[]
  virtualizer: Virtualizer<HTMLDivElement, Element>
  messagesContainerRef: React.RefObject<HTMLDivElement | null>
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  // Message display
  editingMessageId: string | null
  editContent: string
  viewSourceMessageIds: Set<string>
  swipeStates: Record<string, SwipeState>
  setSwipeStates: React.Dispatch<React.SetStateAction<Record<string, SwipeState>>>
  // Appearance
  chatSettings: ChatSettings | null
  roleplayRenderingPatterns: RenderingPattern[] | undefined
  roleplayDialogueDetection: DialogueDetection | null | undefined
  // Multi-char
  isMultiChar: boolean
  participantData: ParticipantData[]
  turnState: TurnState
  streaming: boolean
  streamingContent: string
  waitingForResponse: boolean
  userParticipantId: string | null
  isPaused: boolean
  respondingParticipantId: string | null
  // Message actions - signatures match useMessageActions return type
  messageActions: {
    startEdit: (message: Message) => void
    saveEdit: (messageId: string) => Promise<void>
    cancelEdit: () => void
    toggleSourceView: (messageId: string) => void
    deleteMessage: (messageId: string) => Promise<void>
    generateSwipe: (messageId: string, fetchChat: () => Promise<void>) => void
    switchSwipe: (groupId: string, direction: 'prev' | 'next', swipeStates: Record<string, SwipeState>, setSwipeStates: (value: any) => void) => void
    copyMessageContent: (content: string) => void
    resendMessage: (message: Message) => Promise<void>
    canResendMessage: (messageId: string, index: number) => boolean
  }
  turnManagement: {
    handleNudge: (participantId: string) => void | Promise<void>
    handleQueue: (participantId: string) => void
    handleDequeue: (participantId: string) => void
    handleContinue: () => void
    handleDismissEphemeral: (id: string) => void
  }
  // Handlers
  setEditContent: (content: string) => void
  onTogglePause: () => void
  onOverrideDangerFlag: (messageId: string) => void
  onRemoveCharacter: (participantId: string) => void
  onReattribute: (messageId: string) => void
  onImageClick: (filepath: string, filename: string, fileId?: string) => void
  fetchChat: () => Promise<void>
  // LLM logs
  messagesWithLogs: Set<string>
  onViewLLMLogs: (messageId: string) => void
  // Pending tool calls
  pendingToolCalls: PendingToolCall[]
  // Ephemeral messages
  ephemeralMessages: EphemeralMessageData[]
  // Streaming message display
  getRespondingCharacter: () => CharacterData | undefined
  shouldShowAvatars: () => boolean
  getFirstCharacter: () => CharacterData | null | undefined
  getMessageAvatar: (message: Message) => {
    name: string
    title?: string | null
    avatarUrl?: string | null
    defaultImage?: { id: string; filepath: string; url?: string } | null
  } | null
  /** Mapping of participant IDs to display names for whisper labels */
  participantNames?: Record<string, string>
  /** Set of participant IDs controlled by the user */
  userParticipantIdSet?: Set<string>
  /** Whether the Concierge has flagged this chat as dangerous */
  isDangerousChat?: boolean
}

export function VirtualizedMessageList({
  messages,
  virtualizer,
  messagesContainerRef,
  messagesEndRef,
  editingMessageId,
  editContent,
  viewSourceMessageIds,
  swipeStates,
  setSwipeStates,
  chatSettings,
  roleplayRenderingPatterns,
  roleplayDialogueDetection,
  isMultiChar,
  participantData,
  turnState,
  streaming,
  streamingContent,
  waitingForResponse,
  userParticipantId,
  isPaused,
  respondingParticipantId,
  messageActions,
  turnManagement,
  setEditContent,
  onTogglePause,
  onOverrideDangerFlag,
  onRemoveCharacter,
  onReattribute,
  onImageClick,
  fetchChat,
  messagesWithLogs,
  onViewLLMLogs,
  pendingToolCalls,
  ephemeralMessages,
  getRespondingCharacter,
  shouldShowAvatars,
  getFirstCharacter,
  getMessageAvatar,
  participantNames,
  userParticipantIdSet,
  isDangerousChat = false,
}: VirtualizedMessageListProps) {
  // Resolve per-message character from participantData, falling back to first character
  const getCharacterForMessage = (message: Message): CharacterData | undefined => {
    if (message.participantId) {
      const participant = participantData.find(p => p.id === message.participantId)
      if (participant?.character) {
        return participant.character as CharacterData
      }
    }
    return getFirstCharacter() ?? undefined
  }

  return (
    <div className="qt-chat-messages" ref={messagesContainerRef}>
      <div className="qt-chat-messages-list">
        {/* Virtualized messages rendering */}
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const messageIndex = virtualRow.index
            const message = messages[messageIndex]
            const isEditing = editingMessageId === message.id
            const swipeState = message.swipeGroupId ? swipeStates[message.swipeGroupId] : null
            const showResendButton = messageActions.canResendMessage(message.id, messageIndex)

            if (message.role === 'TOOL') {
              const avatarData = getMessageAvatar(message)
              const systemAvatar =
                message.systemSender && avatarData?.avatarUrl
                  ? { name: avatarData.name, avatarUrl: avatarData.avatarUrl }
                  : undefined
              return (
                <div
                  key={message.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ToolMessage
                    message={message}
                    character={getCharacterForMessage(message)}
                    systemAvatar={systemAvatar}
                    onImageClick={(filepath, filename, fileId) => {
                      onImageClick(filepath, filename, fileId)
                    }}
                  />
                </div>
              )
            }

            const messageAvatarData = shouldShowAvatars() ? getMessageAvatar(message) : null
            const messageAvatar = messageAvatarData as any

            return (
              <div
                key={message.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <MessageRow
                  message={message}
                  messageIndex={messageIndex}
                  isEditing={isEditing}
                  editContent={editContent}
                  viewSourceMessageIds={viewSourceMessageIds}
                  swipeState={swipeState}
                  showResendButton={showResendButton}
                  shouldShowAvatars={shouldShowAvatars()}
                  messageAvatar={messageAvatar}
                  renderingPatterns={roleplayRenderingPatterns}
                  dialogueDetection={roleplayDialogueDetection}
                  forceRender={messageIndex >= messages.length - 5}
                  isMultiChar={isMultiChar}
                  participantData={participantData}
                  turnState={turnState}
                  streaming={streaming}
                  waitingForResponse={waitingForResponse}
                  userParticipantId={userParticipantId}
                  isPaused={isPaused}
                  onTogglePause={onTogglePause}
                  tokenDisplaySettings={chatSettings?.tokenDisplaySettings}
                  dangerousContentSettings={chatSettings?.dangerousContentSettings}
                  onOverrideDangerFlag={onOverrideDangerFlag}
                  character={getCharacterForMessage(message)}
                  onEditStart={messageActions.startEdit}
                  onEditSave={messageActions.saveEdit}
                  onEditCancel={messageActions.cancelEdit}
                  onEditChange={setEditContent}
                  onToggleSourceView={messageActions.toggleSourceView}
                  onDelete={messageActions.deleteMessage}
                  onGenerateSwipe={(msgId) => messageActions.generateSwipe(msgId, fetchChat)}
                  onSwitchSwipe={(groupId, dir) => messageActions.switchSwipe(groupId, dir, swipeStates, setSwipeStates)}
                  onCopyContent={messageActions.copyMessageContent}
                  onResend={messageActions.resendMessage}
                  onImageClick={(filepath, filename, fileId) => {
                    onImageClick(filepath, filename, fileId)
                  }}
                  onHandleNudge={turnManagement.handleNudge}
                  onHandleQueue={turnManagement.handleQueue}
                  onHandleDequeue={turnManagement.handleDequeue}
                  onHandleTalkativenessChange={() => {}}
                  onHandleRemoveCharacter={onRemoveCharacter}
                  onHandleContinue={turnManagement.handleContinue}
                  onReattribute={onReattribute}
                  hasLLMLogs={messagesWithLogs.has(message.id)}
                  onViewLLMLogs={onViewLLMLogs}
                  participantNames={participantNames}
                  isOverheardWhisper={
                    !!(message.targetParticipantIds?.length) &&
                    !!(userParticipantIdSet) &&
                    !(message.participantId && userParticipantIdSet.has(message.participantId)) &&
                    !message.targetParticipantIds.some(id => userParticipantIdSet.has(id))
                  }
                  isDangerousChat={isDangerousChat}
                />
              </div>
            )
          })}
        </div>

        {/* Pending tool calls */}
        <PendingToolCalls pendingToolCalls={pendingToolCalls} />

        {/* Ephemeral messages */}
        <EphemeralMessagesComponent
          messages={ephemeralMessages}
          onDismiss={turnManagement.handleDismissEphemeral}
        />

        {/* Streaming message */}
        <StreamingMessage
          streaming={streaming}
          streamingContent={streamingContent}
          waitingForResponse={waitingForResponse}
          respondingCharacter={getRespondingCharacter()}
          renderingPatterns={roleplayRenderingPatterns}
          dialogueDetection={roleplayDialogueDetection}
          shouldShowAvatars={shouldShowAvatars()}
          isDangerousChat={isDangerousChat}
        />

        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
