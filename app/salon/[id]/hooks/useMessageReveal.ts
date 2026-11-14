'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import { showInfoToast } from '@/lib/toast'
import { MESSAGE_REVEAL_EVENT, takePendingMessageReveal, type MessageRevealRequest } from '@/lib/chat/message-navigation'
import { findConversationMatches, type ConversationSearchSource } from '@/lib/chat/conversation-search'
import type { Message } from '../types'
import { renderItemMessageIds, type RenderItem } from '../announcement-render-items'
import { getAnnouncementSenderName } from '../components/system-message-labels'
import { useSearchHighlight } from './useSearchHighlight'

/**
 * Finding a line in the Salon: the header search bar's in-conversation source
 * (with its match highlight), and revealing a message — scrolling the
 * virtualized transcript to it and flashing it — for a search hit, a `?msg=`
 * link or a reveal request from elsewhere in the workspace.
 */
export function useMessageReveal({
  chatId: id,
  revealMessageId,
  loading,
  isInitialScrollDone,
  messages,
  renderMessages,
  renderItems,
  getMessageAvatar,
  announcerNames,
  messagesContainerRef,
  virtualizer,
  setExpandedSystemMessageIds,
  setConversationSearch,
}: {
  chatId: string
  revealMessageId?: string
  loading: boolean
  isInitialScrollDone: boolean
  messages: Message[]
  renderMessages: Message[]
  renderItems: RenderItem[]
  getMessageAvatar: (message: Message) => { name: string } | null
  announcerNames: Parameters<typeof getAnnouncementSenderName>[1]
  messagesContainerRef: React.RefObject<HTMLDivElement | null>
  virtualizer: Virtualizer<HTMLDivElement, Element>
  setExpandedSystemMessageIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setConversationSearch: (source: ConversationSearchSource | null) => void
}) {
  // --- In-conversation search (header search bar) ---
  // The header search bar looks inside this chat before searching everywhere.
  // The source is one stable object per chat that reads the transcript through
  // a ref, so publishing it never churns the toolbar on a streamed token.
  const [searchHighlightQuery, setSearchHighlightQuery] = useState<string | null>(null)
  useSearchHighlight(messagesContainerRef, searchHighlightQuery)
  const [pendingReveal, setPendingReveal] = useState<{ messageId: string; nonce: number } | null>(null)
  const searchStateRef = useRef({ messages, renderMessages, renderItems, getMessageAvatar, announcerNames })
  useEffect(() => {
    searchStateRef.current = { messages, renderMessages, renderItems, getMessageAvatar, announcerNames }
  }, [messages, renderMessages, renderItems, getMessageAvatar, announcerNames])

  // Scroll a message to the top of the transcript and flash it. The list is
  // virtualized, so the row may not exist yet: expand a collapsed announcement
  // (its text is only on screen expanded), ask the virtualizer for the index,
  // then nudge until the row's top sits at the container's top.
  const revealMessage = useCallback((messageId: string) => {
    // A global search hit can name a line this view doesn't show — a whisper
    // to someone else, or another variant of a reply. Say so rather than
    // silently going nowhere.
    const { messages: allMessages, renderMessages: shown } = searchStateRef.current
    if (!shown.some(m => m.id === messageId)) {
      const hidden = allMessages.find(m => m.id === messageId)
      showInfoToast(
        hidden?.targetParticipantIds?.length
          ? 'That line was a whisper meant for other ears. Choose “Show all whispers” in the sidebar to see it.'
          : 'That line isn’t on the page — it may belong to another version of a reply, or have been tidied away.',
      )
      return
    }
    const inChipGroup = searchStateRef.current.renderItems.some(
      item => item.kind === 'announcement-group' && item.members.some(m => m.message.id === messageId),
    )
    if (inChipGroup) {
      setExpandedSystemMessageIds(prev => (prev.has(messageId) ? prev : new Set(prev).add(messageId)))
    }
    setPendingReveal({ messageId, nonce: Date.now() })
  }, [setExpandedSystemMessageIds])
  const revealMessageRef = useRef(revealMessage)
  useEffect(() => {
    revealMessageRef.current = revealMessage
  }, [revealMessage])

  // --- Scroll to a requested message (`?msg=` links, e.g. a Message search result) ---
  // A request made before this Salon mounted (or loaded) waits in storage until
  // the transcript is here; one made while it is open arrives as an event.
  // Either way only a request for this chat is taken, and only once the
  // initial scroll to the newest message is done (`isInitialScrollDone`), which would
  // otherwise carry the view straight back down. Declared after the refs they
  // read are refreshed, so a just-mounted Salon sees its loaded transcript.
  const routeRevealTakenRef = useRef(false)
  useEffect(() => {
    if (loading || !isInitialScrollDone || messages.length === 0) return
    let target = takePendingMessageReveal(id)
    if (!target && revealMessageId && !routeRevealTakenRef.current) {
      routeRevealTakenRef.current = true
      target = revealMessageId
    }
    if (target) revealMessageRef.current(target)
  }, [loading, isInitialScrollDone, messages.length, id, revealMessageId])
  useEffect(() => {
    if (loading || !isInitialScrollDone) return
    const onReveal = (event: Event) => {
      const request = (event as CustomEvent<MessageRevealRequest>).detail
      if (request?.chatId !== id) return
      const target = takePendingMessageReveal(id)
      if (target) revealMessageRef.current(target)
    }
    window.addEventListener(MESSAGE_REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(MESSAGE_REVEAL_EVENT, onReveal)
  }, [loading, isInitialScrollDone, id])

  useEffect(() => {
    if (!pendingReveal) return
    const { messageId } = pendingReveal
    const index = renderItems.findIndex((item: RenderItem) => renderItemMessageIds(item).includes(messageId))
    if (index < 0) return
    // Still a chip: the expansion above hasn't rendered yet; this effect re-runs when it does.
    if (renderItems[index].kind === 'announcement-group') return

    virtualizer.scrollToIndex(index, { align: 'start' })
    let frame = 0
    let attempts = 0
    let lastScrollTop = -1
    let hiddenFrames = 0
    const settle = () => {
      const container = messagesContainerRef.current
      if (!container || ++attempts > 40) {
        setPendingReveal(null)
        return
      }
      // A kept-alive tab is display:none until it is activated, and a request
      // can arrive in the same tick as the activation: wait until it shows.
      if (container.clientHeight === 0) {
        if (++hiddenFrames > 600) {
          setPendingReveal(null)
          return
        }
        attempts--
        frame = requestAnimationFrame(settle)
        return
      }
      const row = container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
      if (!row) {
        virtualizer.scrollToIndex(index, { align: 'start' })
        frame = requestAnimationFrame(settle)
        return
      }
      const offset = row.getBoundingClientRect().top - container.getBoundingClientRect().top - 12
      // Keep nudging while rows above are still being measured, until the row
      // is at the top or the container can scroll no further.
      if (Math.abs(offset) > 2 && container.scrollTop !== lastScrollTop) {
        lastScrollTop = container.scrollTop
        container.scrollTop += offset
        frame = requestAnimationFrame(settle)
        return
      }
      row.classList.add('qt-memory-source-highlight')
      setTimeout(() => row.classList.remove('qt-memory-source-highlight'), 3000)
      setPendingReveal(null)
    }
    frame = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(frame)
  }, [pendingReveal, renderItems, virtualizer, messagesContainerRef])

  const conversationSearchSource = useMemo<ConversationSearchSource>(() => ({
    chatId: id,
    search: (query, limit) => {
      const { renderMessages: rows, getMessageAvatar: avatarOf, announcerNames: announcers } = searchStateRef.current
      return findConversationMatches(rows, query, {
        limit,
        speakerOf: message =>
          message.systemSender
            ? getAnnouncementSenderName(message, announcers)
            : avatarOf(message)?.name ?? null,
      })
    },
    reveal: messageId => revealMessageRef.current(messageId),
    setHighlight: query => setSearchHighlightQuery(query),
  }), [id])

  // Offer this chat to the header search bar.
  useEffect(() => {
    setConversationSearch(conversationSearchSource)
    return () => {
      conversationSearchSource.setHighlight(null)
      setConversationSearch(null)
    }
  }, [conversationSearchSource, setConversationSearch])
}
