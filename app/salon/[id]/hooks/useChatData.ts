'use client'

import { useCallback, useRef, useState } from 'react'
import { useRealtimeTopic } from '@/hooks/useRealtime'
import { isProvisionalMessage, reconcileTranscript } from './transcript-reconcile'
import type { Chat, Message } from '../types'

export interface SwipeState {
  current: number
  total: number
  messages: Message[]
}

/** Shape of `GET /api/v1/messages?chatId=…&action=transcript`. */
interface TranscriptResponse {
  unchanged?: boolean
  version?: number
  messages?: Message[]
  offSceneCharacters?: Chat['offSceneCharacters']
}

export function useChatData(chatId: string) {
  const [chat, setChat] = useState<Chat | null>(null)
  const [messages, setMessagesState] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [swipeStates, setSwipeStatesState] = useState<Record<string, SwipeState>>({})
  const [chatMemoryCount, setChatMemoryCount] = useState(0)

  // Mirrors of the two pieces of state reconciliation needs to read *while*
  // computing the next one. They are refs rather than deps because a hinted
  // re-read can arrive at any moment, including from inside a stream, and must
  // not depend on a callback having been rebuilt with fresh closures first.
  const messagesRef = useRef<Message[]>([])
  const swipeStatesRef = useRef<Record<string, SwipeState>>({})

  /**
   * The transcript counter as of the last read, or null when we have never
   * read one. Null means "ask for everything" — which is exactly right on the
   * first read and after any response we couldn't make sense of.
   */
  const transcriptVersionRef = useRef<number | null>(null)

  /**
   * Whether any read has put a transcript on screen yet.
   *
   * `useRealtimeTopic` fires its handler on socket open as well as on an event,
   * which is what makes a reconnect after a sleep re-read for free. At *mount*
   * that open-fire races the initial `fetchChat()`, and both would project the
   * whole transcript — attachments resolved and every simple message rendered
   * to HTML — for one chat being opened. The first load is `fetchChat`'s; the
   * subscription starts working once that read has settled, one way or the
   * other.
   */
  const hasTranscriptRef = useRef(false)

  /**
   * Serialization for the hinted read. Two hints can outrun the bus's 250 ms
   * coalescing window when a read takes longer than that, and two overlapping
   * reads can land out of order — applying the older rows last, which is a
   * visible regression of the transcript. One read at a time, with a trailing
   * re-read for anything that arrived while it was out.
   */
  const readInFlightRef = useRef(false)
  const readAgainRef = useRef(false)

  // Both setters resolve against the ref and update it *synchronously*, rather
  // than resolving inside a React updater. A hinted re-read can land in the
  // same tick as an optimistic push, and reconciliation has to be handed the
  // array that push produced — not the one React has yet to process, which
  // would carry no optimistic bubble to preserve and so would drop it.
  const setMessages = useCallback<React.Dispatch<React.SetStateAction<Message[]>>>((value) => {
    const next = typeof value === 'function'
      ? (value as (p: Message[]) => Message[])(messagesRef.current)
      : value
    messagesRef.current = next
    setMessagesState(next)
  }, [])

  const setSwipeStates = useCallback<React.Dispatch<React.SetStateAction<Record<string, SwipeState>>>>((value) => {
    const next = typeof value === 'function'
      ? (value as (p: Record<string, SwipeState>) => Record<string, SwipeState>)(swipeStatesRef.current)
      : value
    swipeStatesRef.current = next
    setSwipeStatesState(next)
  }, [])

  /**
   * Fold a freshly-read transcript into the display.
   *
   * Everything interesting happens in `reconcileTranscript`: the read is the
   * authority, the operator's swipe selection is carried across, an optimistic
   * bubble the read hasn't caught up with stays on screen, and an unchanged
   * transcript hands back the very array it was given so nothing re-renders.
   */
  const applyTranscriptRows = useCallback((rows: Message[]) => {
    const next = reconcileTranscript(rows, messagesRef.current, swipeStatesRef.current)
    setMessages(next.messages)
    setSwipeStates(next.swipeStates)
  }, [setMessages, setSwipeStates])

  /**
   * Drop every provisional bubble still on screen.
   *
   * The turn boundary's broom. Reconciliation retires a bubble the moment the
   * authoritative read carries a row for it, which covers every turn that
   * actually reached the server. What it cannot cover is a send that never
   * persisted at all — a 400, a chat that vanished, a network failure before
   * the POST landed — where there is no row coming and the bubble would
   * otherwise sit in the transcript forever, showing the operator a line that
   * is not in the room. The send path calls this once the turn is over.
   */
  const clearProvisionalMessages = useCallback(() => {
    setMessages((prev) => (prev.some(isProvisionalMessage) ? prev.filter((m) => !isProvisionalMessage(m)) : prev))
  }, [setMessages])

  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch chat')
      const data = await res.json()
      setChat(data.chat)
      transcriptVersionRef.current = typeof data.chat?.transcriptVersion === 'number'
        ? data.chat.transcriptVersion
        : null
      applyTranscriptRows((data.chat?.messages ?? []) as Message[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
      // Open the gate whether or not the read succeeded. On success the hinted
      // re-read has a version to be conditional about; on failure it has none,
      // so the next hint or reconnect performs a full read — which is the only
      // recovery a tab whose first load failed is going to get.
      hasTranscriptRef.current = true
    }
  }, [chatId, applyTranscriptRows])

  /**
   * One conditional round trip. The body {@link refreshTranscript} runs; call
   * that, not this, so reads stay serialized.
   */
  const readTranscriptOnce = useCallback(async () => {
    try {
      const known = transcriptVersionRef.current
      const query = new URLSearchParams({ chatId, action: 'transcript' })
      if (known !== null) query.set('knownVersion', String(known))

      const res = await fetch(`/api/v1/messages?${query.toString()}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as TranscriptResponse
      if (data.unchanged) return

      // A read that overlapped a newer one — a `fetchChat` that landed while
      // this was out — must not walk the transcript backwards.
      const applied = transcriptVersionRef.current
      if (typeof data.version === 'number' && applied !== null && data.version < applied) return

      transcriptVersionRef.current = typeof data.version === 'number' ? data.version : null
      hasTranscriptRef.current = true
      applyTranscriptRows(data.messages ?? [])

      // Announcement bubbles and Carina answers can be authored by someone who
      // isn't a participant; without their card the renderer has no avatar to
      // draw. They ride along with the transcript for exactly that reason.
      if (data.offSceneCharacters) {
        const offScene = data.offSceneCharacters
        setChat((prev) => (prev ? { ...prev, offSceneCharacters: offScene } : prev))
      }
    } catch (err) {
      // A failed re-read is not a failed conversation: the next hint, the
      // socket's own reconnect catch-up, or the next mount will try again.
      console.error('Failed to refresh chat transcript:', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [chatId, applyTranscriptRows])

  /**
   * Re-read the transcript, conditionally.
   *
   * This is the authoritative delivery path for every message in the room. The
   * SSE stream still carries tokens for the turn being generated, but it no
   * longer decides what the room *contains*: a reply that was persisted while
   * the stream was dropped, an Aurora wardrobe note, a Lantern backdrop
   * announcement or a Commonplace whisper written from the forked child all
   * land here, on the hint the write already published.
   *
   * The read hands back the version it last saw, so the common case — a hint
   * that fired for something other than a message — costs a round trip and the
   * word "unchanged", not a re-serialized conversation. That matters because
   * one busy turn fires wardrobe, backdrop, whisper and memory hints at the
   * same `chats` topic.
   *
   * Every hint and every socket reconnect comes through here. It runs at most
   * one read at a time and takes a trailing pass for anything that arrived
   * while that read was out, so two hints in quick succession can never apply
   * their rows out of order.
   */
  const refreshTranscript = useCallback(async () => {
    if (!hasTranscriptRef.current) return
    if (readInFlightRef.current) {
      readAgainRef.current = true
      return
    }
    readInFlightRef.current = true
    try {
      do {
        readAgainRef.current = false
        await readTranscriptOnce()
      } while (readAgainRef.current)
    } finally {
      readInFlightRef.current = false
    }
  }, [readTranscriptOnce])

  const fetchChatMemoryCount = useCallback(async () => {
    try {
      // `no-store`, matching its siblings in this hook: a cached 200 would hand
      // back the stale count on the very refetch meant to correct it.
      const res = await fetch(`/api/v1/memories?chatId=${chatId}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setChatMemoryCount(data.memoryCount || 0)
      }
    } catch (err) {
      console.error('Failed to fetch chat memory count:', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [chatId])

  // The transcript is a subscribed read. Until it was, the only way a message
  // could reach an open tab was the read loop of the `POST /api/v1/messages`
  // fetch the tab itself issued — so a stream that dropped during a long
  // generation lost the reply outright (it stayed in the database, waiting for
  // a reload), and anything written out-of-band arrived only if it happened to
  // be enqueued into an open stream at the right moment. The write funnel
  // publishes `{topic:'chats', id}` on every add, edit and delete, and this is
  // what listens. `useRealtimeTopic` also fires on socket open, so a tab that
  // slept re-reads for free, and the offline fallback is the next mount — no
  // poll, per the standing rule.
  useRealtimeTopic('chats', refreshTranscript, chatId)

  // The count is read once at mount, and memories land minutes later — from
  // MEMORY_EXTRACTION and friends in the forked child, turn after turn. The
  // workspace keeps a hidden Salon tab mounted for the life of the session, so
  // without a path by which the server can say "this changed", the number
  // beside the Delete Memories button stays frozen at whatever was true when
  // the tab opened. It lives here rather than at the call site because this is
  // the hook that owns the count: a consumer cannot forget to subscribe.
  // `useRealtimeTopic` also fires on socket open, so a reconnect after a sleep
  // re-reads for free, and the offline fallback is the next mount — no poll.
  useRealtimeTopic('memories', fetchChatMemoryCount, chatId)

  return {
    chat,
    setChat,
    messages,
    setMessages,
    loading,
    error,
    swipeStates,
    setSwipeStates,
    chatMemoryCount,
    setChatMemoryCount,
    fetchChat,
    refreshTranscript,
    clearProvisionalMessages,
    fetchChatMemoryCount,
  }
}
