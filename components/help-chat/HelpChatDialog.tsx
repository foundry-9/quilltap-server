'use client'

/**
 * HelpChatDialog
 *
 * The main help chat interface rendered inside a FloatingDialog.
 * Two states: launcher (character selection + past chats) and active chat.
 */

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FloatingDialog } from '@/components/ui/FloatingDialog'
import { useHelpChat } from '@/components/providers/help-chat-provider'
import { HelpChatComposer } from './HelpChatComposer'
import { HelpChatMessageList } from './HelpChatMessageList'
import { useHelpChatStreaming } from './hooks/useHelpChatStreaming'

interface PastChat {
  id: string
  title: string
  updatedAt: string
  participants: Array<{ id: string; name: string; avatarUrl?: string | null }>
  messageCount: number
}

interface ChatMessage {
  id: string
  role: string
  content: string
  participantId?: string | null
  createdAt: string
  provider?: string | null
  modelName?: string | null
}

interface CharacterInfo {
  id: string
  name: string
  avatarUrl: string | null
}

export function HelpChatDialog() {
  const {
    isOpen,
    closeHelpChat,
    currentChatId,
    setCurrentChatId,
    eligibleCharacters,
    selectedCharacterIds,
    toggleCharacter,
    currentPageUrl,
  } = useHelpChat()

  const router = useRouter()
  const [pastChats, setPastChats] = useState<PastChat[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [characterMap, setCharacterMap] = useState<Map<string, CharacterInfo>>(new Map())
  const [participantToCharacter, setParticipantToCharacter] = useState<Map<string, string>>(new Map())
  const [loadingMessages, setLoadingMessages] = useState(false)

  const handleNavigate = useCallback((url: string) => {
    router.push(url)
  }, [router])

  const loadMessages = useCallback(async (chatId: string) => {
    setLoadingMessages(true)
    try {
      const res = await fetch(`/api/v1/help-chats/${chatId}/messages`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])

        // Also load chat details to build character/participant maps
        const chatRes = await fetch(`/api/v1/help-chats/${chatId}`)
        if (chatRes.ok) {
          const chatData = await chatRes.json()
          const chat = chatData.chat
          if (chat?.participants) {
            const newCharMap = new Map<string, CharacterInfo>()
            const newPtcMap = new Map<string, string>()
            for (const p of chat.participants) {
              if (p.characterId && p.name) {
                newCharMap.set(p.characterId, {
                  id: p.characterId,
                  name: p.name,
                  avatarUrl: p.avatarUrl || null,
                })
                newPtcMap.set(p.id, p.characterId)
              }
            }
            setCharacterMap(newCharMap)
            setParticipantToCharacter(newPtcMap)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load help chat messages:', error)
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  const handleMessageComplete = useCallback(() => {
    // Reload messages to get the saved version
    if (currentChatId) {
      loadMessages(currentChatId)
    }
  }, [currentChatId, loadMessages])

  const {
    isStreaming,
    streamingContent,
    streamingParticipantId,
    error: streamError,
    sendMessage,
  } = useHelpChatStreaming({
    chatId: currentChatId,
    onMessageComplete: handleMessageComplete,
    onNavigate: handleNavigate,
  })

  const fetchPastChats = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/help-chats')
      if (res.ok) {
        const data = await res.json()
        setPastChats(data.chats || [])
      }
    } catch (error) {
      console.error('Failed to fetch past help chats:', error)
    }
  }, [])

  // Load past chats when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchPastChats()
    }
  }, [isOpen, fetchPastChats])

  // Load messages when chat changes
  useEffect(() => {
    if (currentChatId) {
      loadMessages(currentChatId)
    } else {
      setMessages([])
    }
  }, [currentChatId, loadMessages])

  const handleCreateChat = useCallback(async (question: string) => {
    const eligible = eligibleCharacters.filter(c => c.hasToolCapableProfile)
    const charIds = selectedCharacterIds.filter(id => eligible.some(c => c.id === id))
    if (charIds.length === 0 && eligible.length > 0) {
      charIds.push(eligible[0].id)
    }
    if (charIds.length === 0) return

    try {
      const res = await fetch('/api/v1/help-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterIds: charIds,
          pageUrl: currentPageUrl,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const chatId = data.chat?.id
        if (chatId) {
          setCurrentChatId(chatId)

          // Build maps from the newly created chat
          if (data.chat?.participants) {
            const newCharMap = new Map<string, CharacterInfo>()
            const newPtcMap = new Map<string, string>()
            for (const p of data.chat.participants) {
              if (p.characterId && p.name) {
                newCharMap.set(p.characterId, { id: p.characterId, name: p.name, avatarUrl: p.avatarUrl || null })
                newPtcMap.set(p.id, p.characterId)
              }
            }
            setCharacterMap(newCharMap)
            setParticipantToCharacter(newPtcMap)
          }

          // Send the question
          sendMessage(question)
        }
      }
    } catch (error) {
      console.error('Failed to create help chat:', error)
    }
  }, [eligibleCharacters, selectedCharacterIds, currentPageUrl, setCurrentChatId, sendMessage])

  const handleSend = useCallback((content: string) => {
    if (!currentChatId) {
      // Create new chat with this question
      handleCreateChat(content)
    } else {
      sendMessage(content)
    }
  }, [currentChatId, sendMessage, handleCreateChat])

  const handleSelectPastChat = useCallback((chatId: string) => {
    setCurrentChatId(chatId)
  }, [setCurrentChatId])

  const handleNewChat = useCallback(() => {
    setCurrentChatId(null)
    setMessages([])
  }, [setCurrentChatId])

  const handleDeleteChat = useCallback(async (chatId: string) => {
    try {
      await fetch(`/api/v1/help-chats/${chatId}`, { method: 'DELETE' })
      setPastChats(prev => prev.filter(c => c.id !== chatId))
      if (currentChatId === chatId) {
        setCurrentChatId(null)
        setMessages([])
      }
    } catch (error) {
      console.error('Failed to delete help chat:', error)
    }
  }, [currentChatId, setCurrentChatId])

  // Title for the dialog header
  const dialogTitle = currentChatId
    ? (pastChats.find(c => c.id === currentChatId)?.title || 'Help Chat')
    : 'Help'

  return (
    <FloatingDialog
      isOpen={isOpen}
      onClose={closeHelpChat}
      title={dialogTitle}
      headerActions={
        currentChatId ? (
          <button
            type="button"
            onClick={handleNewChat}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="New help chat"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        ) : undefined
      }
    >
      {!currentChatId ? (
        /* Launcher view */
        <div className="flex flex-col h-full">
          {/* Character selection */}
          <div className="p-3 border-b border-border">
            <div className="qt-help-section-label">Help Characters</div>
            <div className="flex flex-wrap gap-2">
              {eligibleCharacters.filter(c => c.hasToolCapableProfile).map(char => {
                const isSelected = selectedCharacterIds.includes(char.id)
                return (
                  <button
                    key={char.id}
                    type="button"
                    onClick={() => toggleCharacter(char.id)}
                    className="qt-help-char-pill"
                    data-selected={isSelected}
                    title={char.name}
                  >
                    <div className="w-5 h-5 rounded-full bg-muted overflow-hidden flex-shrink-0">
                      {char.avatarUrl ? (
                        <img src={char.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="flex items-center justify-center w-full h-full text-[10px]">
                          {char.name[0]}
                        </span>
                      )}
                    </div>
                    {char.name}
                  </button>
                )
              })}
              {eligibleCharacters.filter(c => c.hasToolCapableProfile).length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No eligible help characters. Enable help tools on a character with a tool-capable connection profile.
                </div>
              )}
            </div>
          </div>

          {/* Past chats */}
          <div className="flex-1 overflow-y-auto">
            {pastChats.length > 0 && (
              <div className="p-3">
                <div className="qt-help-section-label">Recent Help Chats</div>
                <div className="flex flex-col gap-1">
                  {pastChats.map(chat => (
                    <div
                      key={chat.id}
                      className="qt-help-past-chat group"
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectPastChat(chat.id)}
                        className="flex-1 text-left truncate text-sm"
                      >
                        {chat.title || 'Untitled'}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {chat.messageCount}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id) }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                        title="Delete"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Question input */}
          <HelpChatComposer
            onSend={handleSend}
            disabled={eligibleCharacters.filter(c => c.hasToolCapableProfile).length === 0}
            placeholder="What would you like help with?"
          />
        </div>
      ) : (
        /* Chat view */
        <div className="flex flex-col h-full">
          {streamError && (
            <div className="qt-help-error">
              {streamError}
            </div>
          )}

          <HelpChatMessageList
            messages={messages}
            characterMap={characterMap}
            participantToCharacter={participantToCharacter}
            streamingContent={streamingContent}
            streamingParticipantId={streamingParticipantId}
            isStreaming={isStreaming}
          />

          <HelpChatComposer
            onSend={handleSend}
            disabled={isStreaming || loadingMessages}
          />
        </div>
      )}
    </FloatingDialog>
  )
}
