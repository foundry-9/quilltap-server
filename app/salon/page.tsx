'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { ImportWizard } from '@/components/import/import-wizard'
import { ChatCard } from '@/components/chat/ChatCard'
import {
  confirmAndDeleteChat,
  transformSalonChatToCardData,
  type SalonChatShape,
} from '@/lib/chat-utils'

type Chat = SalonChatShape

export default function ChatsPage() {
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [highlightedChatId, setHighlightedChatId] = useState<string | null>(null)
  const importedChatRef = useRef<HTMLDivElement>(null)
  const { shouldHideByIds, hideDangerousChats } = useQuickHide()

  const { data: chatsData, isLoading: chatsLoading, error: chatsError, mutate: mutateChats } = useSWR<{ chats: Chat[] }>('/api/v1/chats')
  const { data: charactersData, isLoading: charactersLoading } = useSWR<{ characters: Array<{ id: string; name: string; title?: string | null }> }>('/api/v1/characters')
  const { data: profilesData, isLoading: profilesLoading } = useSWR<{ profiles: Array<{ id: string; name: string }> }>('/api/v1/connection-profiles')

  const chats = useMemo(() => chatsData?.chats ?? [], [chatsData])
  const characters = useMemo(
    () => (charactersData?.characters ?? []).map((c) => ({ id: c.id, name: c.name, title: c.title })),
    [charactersData]
  )
  const profiles = useMemo(
    () => (profilesData?.profiles ?? []).map((p) => ({ id: p.id, name: p.name })),
    [profilesData]
  )
  const loading = chatsLoading || charactersLoading || profilesLoading
  const error = chatsError ? (chatsError instanceof Error ? chatsError.message : 'An error occurred') : null

  const visibleChats = useMemo(
    () => chats.filter(chat => {
      // Collect all tag IDs: chat tags + all participant tags
      const allTagIds: string[] = chat.tags.map(ct => ct.tag.id)

      for (const participant of chat.participants) {
        if (participant.character?.tags) {
          allTagIds.push(...participant.character.tags)
        }
      }

      if (shouldHideByIds(allTagIds)) {
        return false
      }

      // Check danger filter using full chat metadata
      if (hideDangerousChats && chat.isDangerousChat === true) {
        return false
      }

      return true
    }),
    [chats, shouldHideByIds, hideDangerousChats]
  )

  // Auto-scroll and highlight imported chat
  useEffect(() => {
    if (highlightedChatId && importedChatRef.current) {
      importedChatRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Clear the highlight after animation completes (2.5 seconds)
      const timer = setTimeout(() => {
        setHighlightedChatId(null)
      }, 2500)

      return () => clearTimeout(timer)
    }
  }, [highlightedChatId])

  const deleteChat = async (id: string) => {
    if (await confirmAndDeleteChat(id)) {
      await mutateChats()
    }
  }

  /**
   * Handle import completion from the new wizard
   */
  const handleImportComplete = useCallback(async (chatId: string) => {
    // Highlight the imported chat
    setHighlightedChatId(chatId)
    setImportDialogOpen(false)
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading chats...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg qt-text-destructive">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="chat-page qt-page-container text-foreground" style={{ '--story-background-url': 'url(/images/salon.webp)' } as React.CSSProperties}>
      {/* Highlight animation styles */}
      <style>{`
        @keyframes chatCardHighlight {
          0% { opacity: 1; transform: translateX(0); }
          50% { opacity: 1; transform: translateX(10px); }
          100% { opacity: 0; transform: translateX(10px); }
        }
        .chat-card-highlight-arrow {
          animation: chatCardHighlight 2.5s ease-out forwards;
        }
      `}</style>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b qt-border-default/60 pb-6">
        <h1 className="qt-heading-1 leading-tight">Chats</h1>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="qt-button chat-toolbar__button inline-flex items-center rounded-lg border qt-border-default qt-bg-muted/70 px-4 py-2 text-sm qt-text-primary qt-shadow-sm transition hover:qt-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Import SillyTavern Chat
          </button>
          <Link
            href="/salon/new"
            className="qt-button chat-toolbar__button chat-toolbar__button--primary inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-md transition hover:qt-bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            New Chat
          </Link>
        </div>
      </div>

      {visibleChats.length === 0 ? (
        <div className="chat-empty-state mt-12 rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-12 text-center qt-shadow-sm">
          <p className="mb-4 text-lg qt-text-small">No chats yet</p>
          <Link
            href="/salon/new"
            className="font-medium text-primary hover:text-primary/80"
          >
            Start a new chat
          </Link>
        </div>
      ) : (
        <div className="chat-card-stack space-y-4">
          {visibleChats.map((chat) => (
            <ChatCard
              key={chat.id}
              chat={transformSalonChatToCardData(chat)}
              showAvatars={true}
              showProject={true}
              actionType="delete"
              onDelete={deleteChat}
              highlighted={highlightedChatId === chat.id}
              cardRef={highlightedChatId === chat.id ? importedChatRef : undefined}
            />
          ))}
        </div>
      )}

      {/* Import Wizard */}
      {importDialogOpen && (
        <ImportWizard
          characters={characters}
          profiles={profiles}
          onClose={() => setImportDialogOpen(false)}
          onImportComplete={handleImportComplete}
        />
      )}
    </div>
  )
}
