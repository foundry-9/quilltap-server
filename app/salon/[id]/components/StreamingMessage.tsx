import { QuillAnimation } from '@/components/chat/QuillAnimation'
import MessageContent from '@/components/chat/MessageContent'
import Avatar from '@/components/ui/Avatar'
import type { CharacterData } from '../types'
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types'

interface StreamingMessageProps {
  streaming: boolean
  streamingContent: string
  waitingForResponse: boolean
  respondingCharacter: CharacterData | undefined
  /** Patterns for styling roleplay text in message content */
  renderingPatterns?: RenderingPattern[]
  /** Optional dialogue detection for paragraph-level styling */
  dialogueDetection?: DialogueDetection | null
  shouldShowAvatars: boolean
  /** Whether the Concierge has flagged this chat as dangerous */
  isDangerousChat?: boolean
}

export function StreamingMessage({
  streaming,
  streamingContent,
  waitingForResponse,
  respondingCharacter,
  renderingPatterns,
  dialogueDetection,
  shouldShowAvatars,
  isDangerousChat = false,
}: StreamingMessageProps) {
  if (!waitingForResponse && !streaming) return null

  return (
    <div className="qt-chat-message-row qt-chat-message-row-assistant">
      {shouldShowAvatars && (
        <div className={`flex-shrink-0 qt-chat-desktop-avatar${isDangerousChat ? ' qt-chat-avatar-dangerous' : ''}`}>
          <Avatar
            name={respondingCharacter?.name || 'AI'}
            title={null}
            src={respondingCharacter}
            size="chat"
            showName
            showTitle
            className="flex flex-col items-center w-32 gap-1"
          />
        </div>
      )}
      <div className="qt-chat-message-body">
        {waitingForResponse && !streaming ? (
          <div className="qt-text-secondary">
            <QuillAnimation size="lg" />
          </div>
        ) : (
          <div className="flex-1 min-w-0 px-4 py-3 rounded-lg qt-bg-card border qt-border-default text-foreground">
            <MessageContent content={streamingContent} renderingPatterns={renderingPatterns} dialogueDetection={dialogueDetection} />
            <QuillAnimation size="sm" className="inline-block ml-2 qt-text-secondary" />
          </div>
        )}
      </div>
    </div>
  )
}
