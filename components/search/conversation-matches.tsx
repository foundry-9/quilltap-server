'use client'

import { HighlightedText } from './search-results'
import { activateOnKey } from '@/components/ui/activate-on-key'
import type { ConversationMatch } from '@/lib/chat/conversation-search'

interface ConversationMatchesProps {
  matches: ConversationMatch[]
  /** Every matching message, including those past the shown list. */
  total: number
  query: string
  onSelect: (messageId: string) => void
}

function formatWhen(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * The "This conversation" group of the search bar: matches inside the open
 * Salon chat, newest first. Picking one scrolls the transcript to it; it does
 * not navigate, so these are buttons rather than links.
 */
export function ConversationMatches({ matches, total, query, onSelect }: ConversationMatchesProps) {
  return (
    <div className="py-2" role="group" aria-label="Matches in this conversation">
      <div className="px-3 py-1 qt-text-xs font-semibold uppercase tracking-wider">
        <span aria-hidden="true">🔖</span> This conversation ({matches.length < total ? `${matches.length}/${total}` : total})
      </div>
      {matches.length === 0 ? (
        <p className="px-3 py-2 qt-text-small">Not a whisper of &quot;{query}&quot; in this conversation</p>
      ) : (
        <div className="space-y-1">
          {matches.map(match => (
            // role="button" on a div, not a <button>: the row is prose, and two
            // bundled themes set every <button> in tracked capitals.
            <div
              key={match.messageId}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(match.messageId)}
              onKeyDown={activateOnKey}
              className="block w-full text-left p-3 qt-hover-accent rounded-lg transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="qt-text-primary truncate">{match.speaker ?? 'Unknown speaker'}</span>
                {match.isAnnouncement && (
                  <span className="text-xs px-1.5 py-0.5 rounded qt-badge-info">Announcement</span>
                )}
                {match.occurrences > 1 && (
                  <span className="qt-text-xs">×{match.occurrences}</span>
                )}
                <span className="qt-text-xs ml-auto">{formatWhen(match.createdAt)}</span>
              </div>
              <p className="qt-text-small mt-1 line-clamp-2">
                <HighlightedText text={match.snippet} query={query.trim()} />
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
