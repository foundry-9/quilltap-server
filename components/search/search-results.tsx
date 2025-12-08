'use client'

import Link from 'next/link'
import { clientLogger } from '@/lib/client-logger'
import type {
  SearchResult,
  SearchType,
  CharacterSearchResult,
  PersonaSearchResult,
  ChatSearchResult,
  TagSearchResult,
  MemorySearchResult,
} from './types'
import { TYPE_ICONS, TYPE_LABELS, TYPE_LABELS_PLURAL } from './types'

interface SearchResultsProps {
  results: SearchResult[]
  query: string
  isLoading?: boolean
  onResultClick?: () => void
}

// Individual result card components
function CharacterResultCard({ result, query, onResultClick }: { result: CharacterSearchResult; query: string; onResultClick?: () => void }) {
  return (
    <Link
      href={result.url}
      onClick={() => {
        clientLogger.debug('Search result clicked', { type: 'character', id: result.id, query })
        onResultClick?.()
      }}
      className="block p-3 hover:bg-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        {result.avatarUrl ? (
          <img
            src={result.avatarUrl}
            alt={result.name}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
            <span className="text-lg">{TYPE_ICONS.characters}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">
              {result.name}
            </span>
            {result.isFavorite && <span className="text-yellow-500">★</span>}
            <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
              {TYPE_LABELS.characters}
            </span>
          </div>
          {result.title && (
            <p className="text-xs text-muted-foreground truncate">{result.title}</p>
          )}
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {result.matchedTag ? (
              <span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs mr-1">
                  🏷️ {result.matchedTag.name}
                </span>
                {result.snippet.replace(`Tagged with "${result.matchedTag.name}"`, '').replace(/^[:\s-]+/, '')}
              </span>
            ) : (
              <HighlightedText text={result.snippet} query={query} />
            )}
          </p>
        </div>
      </div>
    </Link>
  )
}

function PersonaResultCard({ result, query, onResultClick }: { result: PersonaSearchResult; query: string; onResultClick?: () => void }) {
  return (
    <Link
      href={result.url}
      onClick={() => {
        clientLogger.debug('Search result clicked', { type: 'persona', id: result.id, query })
        onResultClick?.()
      }}
      className="block p-3 hover:bg-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        {result.avatarUrl ? (
          <img
            src={result.avatarUrl}
            alt={result.name}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <span className="text-lg">{TYPE_ICONS.personas}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">
              {result.name}
            </span>
            <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
              {TYPE_LABELS.personas}
            </span>
          </div>
          {result.title && (
            <p className="text-xs text-muted-foreground truncate">{result.title}</p>
          )}
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {result.matchedTag ? (
              <span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs mr-1">
                  🏷️ {result.matchedTag.name}
                </span>
                {result.snippet.replace(`Tagged with "${result.matchedTag.name}"`, '').replace(/^[:\s-]+/, '')}
              </span>
            ) : (
              <HighlightedText text={result.snippet} query={query} />
            )}
          </p>
        </div>
      </div>
    </Link>
  )
}

function ChatResultCard({ result, query, onResultClick }: { result: ChatSearchResult; query: string; onResultClick?: () => void }) {
  const isRelatedResult = result.matchedViaCharacter || result.matchedViaPersona

  return (
    <Link
      href={result.url}
      onClick={() => {
        clientLogger.debug('Search result clicked', { type: 'chat', id: result.id, query })
        onResultClick?.()
      }}
      className="block p-3 hover:bg-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">{TYPE_ICONS.chats}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-foreground truncate">
              {result.name}
            </span>
            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
              {TYPE_LABELS.chats}
            </span>
            {isRelatedResult && (
              <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                Related
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {result.characterNames && result.characterNames.length > 0 && (
              <span>with {result.characterNames.join(', ')}</span>
            )}
            {result.messageCount !== undefined && (
              <span>• {result.messageCount} messages</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {result.matchedTag ? (
              <span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs mr-1">
                  🏷️ {result.matchedTag.name}
                </span>
                {result.snippet.replace(`Tagged with "${result.matchedTag.name}"`, '').replace(/^[:\s-]+/, '')}
              </span>
            ) : result.matchedViaCharacter ? (
              <span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs mr-1">
                  🎭 {result.matchedViaCharacter.name}
                </span>
                Chat includes matching character
              </span>
            ) : result.matchedViaPersona ? (
              <span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs mr-1">
                  👤 {result.matchedViaPersona.name}
                </span>
                Chat includes matching persona
              </span>
            ) : (
              <HighlightedText text={result.snippet} query={query} />
            )}
          </p>
        </div>
      </div>
    </Link>
  )
}

function TagResultCard({ result, query, onResultClick }: { result: TagSearchResult; query: string; onResultClick?: () => void }) {
  return (
    <Link
      href={`/api/search?q=${encodeURIComponent(result.name)}&types=characters,personas,chats,memories`}
      onClick={(e) => {
        // For tags, we want to show items with this tag
        // This will be handled by the SearchDialog to show expanded results
        clientLogger.debug('Tag search result clicked', { type: 'tag', id: result.id, name: result.name, query })
        onResultClick?.()
      }}
      className="block p-3 hover:bg-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">{TYPE_ICONS.tags}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">
              <HighlightedText text={result.name} query={query} />
            </span>
            <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
              {TYPE_LABELS.tags}
            </span>
            {result.quickHide && (
              <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground rounded">
                Quick Hide
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Used {result.usageCount} time{result.usageCount !== 1 ? 's' : ''} across characters, personas, and chats
          </p>
        </div>
      </div>
    </Link>
  )
}

function MemoryResultCard({ result, query, onResultClick }: { result: MemorySearchResult; query: string; onResultClick?: () => void }) {
  return (
    <Link
      href={result.url}
      onClick={() => {
        clientLogger.debug('Search result clicked', { type: 'memory', id: result.id, query })
        onResultClick?.()
      }}
      className="block p-3 hover:bg-accent rounded-lg transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">{TYPE_ICONS.memories}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">
              {result.name}
            </span>
            <span className="text-xs px-1.5 py-0.5 bg-pink-100 text-pink-700 rounded">
              {TYPE_LABELS.memories}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              result.source === 'MANUAL'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-muted text-muted-foreground'
            }`}>
              {result.source === 'MANUAL' ? 'Manual' : 'Auto'}
            </span>
          </div>
          {result.characterName && (
            <p className="text-xs text-muted-foreground">
              Memory for {result.characterName}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {result.matchedTag ? (
              <span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs mr-1">
                  🏷️ {result.matchedTag.name}
                </span>
                {result.snippet.replace(`Tagged with "${result.matchedTag.name}"`, '').replace(/^[:\s-]+/, '')}
              </span>
            ) : (
              <HighlightedText text={result.snippet} query={query} />
            )}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Importance:</span>
              <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-pink-500 rounded-full"
                  style={{ width: `${result.importance * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

// Highlight matching text
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>

  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 text-foreground rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

export function SearchResults({ results, query, isLoading, onResultClick }: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="p-6 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        <p className="mt-2 text-sm text-muted-foreground">Searching...</p>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">
          No results found for &quot;{query}&quot;
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Try searching for characters, chats, personas, tags, or memories
        </p>
      </div>
    )
  }

  // Group results by type for better organization
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.type]) {
      acc[result.type] = []
    }
    acc[result.type].push(result)
    return acc
  }, {} as Record<SearchType, SearchResult[]>)

  return (
    <div className="divide-y divide-border">
      {Object.entries(groupedResults).map(([type, typeResults]) => (
        <div key={type} className="py-2">
          <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {TYPE_ICONS[type as SearchType]} {TYPE_LABELS_PLURAL[type as SearchType]} ({typeResults.length})
          </div>
          <div className="space-y-1">
            {typeResults.map((result) => {
              switch (result.type) {
                case 'characters':
                  return <CharacterResultCard key={result.id} result={result as CharacterSearchResult} query={query} onResultClick={onResultClick} />
                case 'personas':
                  return <PersonaResultCard key={result.id} result={result as PersonaSearchResult} query={query} onResultClick={onResultClick} />
                case 'chats':
                  return <ChatResultCard key={result.id} result={result as ChatSearchResult} query={query} onResultClick={onResultClick} />
                case 'tags':
                  return <TagResultCard key={result.id} result={result as TagSearchResult} query={query} onResultClick={onResultClick} />
                case 'memories':
                  return <MemoryResultCard key={result.id} result={result as MemorySearchResult} query={query} onResultClick={onResultClick} />
                default:
                  return null
              }
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
