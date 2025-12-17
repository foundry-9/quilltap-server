import { QuillAnimation } from '@/components/chat/QuillAnimation'
import MessageContent from '@/components/chat/MessageContent'
import Avatar from '@/components/ui/Avatar'
import type { CharacterData, Participant } from '../types'

interface StreamingMessageProps {
  streaming: boolean
  streamingContent: string
  waitingForResponse: boolean
  respondingCharacter: CharacterData | undefined
  roleplayTemplateName: string | null
  shouldShowAvatars: boolean
  onStopClick: () => void
}

export function StreamingMessage({
  streaming,
  streamingContent,
  waitingForResponse,
  respondingCharacter,
  roleplayTemplateName,
  shouldShowAvatars,
  onStopClick,
}: StreamingMessageProps) {
  if (!waitingForResponse && !streaming) return null

  return (
    <div className="qt-chat-message-row qt-chat-message-row-assistant">
      {shouldShowAvatars && (
        <div className="flex-shrink-0 qt-chat-desktop-avatar">
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
        {shouldShowAvatars && (
          <div className="qt-chat-message-mobile-header">
            <div className="qt-chat-message-mobile-avatar">
              {(() => {
                const avatarSrc = respondingCharacter?.avatarUrl || (respondingCharacter?.defaultImage?.url || respondingCharacter?.defaultImage?.filepath)
                const normalizedSrc = avatarSrc && (avatarSrc.startsWith('/') ? avatarSrc : `/${avatarSrc}`)
                return normalizedSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={normalizedSrc} alt={respondingCharacter?.name || 'AI'} />
                ) : (
                  <div className="qt-chat-message-mobile-avatar-initial">
                    {(respondingCharacter?.name || 'AI').charAt(0).toUpperCase()}
                  </div>
                )
              })()}
            </div>
            <span className="qt-chat-message-mobile-name">{respondingCharacter?.name || 'AI'}</span>
            {streaming && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onStopClick()
                }}
                className="qt-button qt-chat-stop-button-mobile"
                title="Stop generating"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            )}
          </div>
        )}
        {waitingForResponse && !streaming ? (
          <div className="text-muted-foreground">
            <QuillAnimation size="lg" />
          </div>
        ) : (
          <div className="flex-1 min-w-0 px-4 py-3 rounded-lg bg-card border border-border text-foreground">
            <MessageContent content={streamingContent} roleplayTemplateName={roleplayTemplateName} />
            <QuillAnimation size="sm" className="inline-block ml-2 text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  )
}
