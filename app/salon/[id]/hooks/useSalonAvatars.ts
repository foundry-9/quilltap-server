'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeFallbackPoll, useRealtimeRefetchInterval, useRealtimeTopic } from '@/hooks/useRealtime'
import { showErrorToast, showInfoToast } from '@/lib/toast'
import { BRAHMA_CARINA_ANSWERER_ID } from '@/lib/services/carina/brahma-answerer'
import { staffAvatar } from '@/lib/chat/staff-display-names'
import { avatarAt, indexAvatarTimeline, type SalonAvatarSegment } from '@/lib/chat/salon-avatar'
import type { Chat, CharacterData, Message } from '../types'
import type { useParticipants } from './useParticipants'

/** Fallback re-read cadence for the avatar watch, while the socket is down. */
const AVATAR_POLL_INTERVAL_MS = 5000
/** How long the avatar watch waits before giving up on a generation. */
const AVATAR_WATCH_TIMEOUT_MS = 2 * 60_000
/** Fallback re-read cadence for the avatar timeline, while the socket is down. */
const AVATAR_TIMELINE_FALLBACK_POLL_MS = 30_000

/**
 * The Salon's faces: the regenerate-avatar action with its watch for the new
 * image, and `getMessageAvatar` — the name, title and face each bubble wears,
 * from the chat's avatar timeline (`lib/chat/salon-avatar.ts`).
 */
export function useSalonAvatars({
  chatId: id,
  chat,
  fetchChat,
  participants,
}: {
  chatId: string
  chat: Chat | null
  fetchChat: () => Promise<void>
  participants: Pick<ReturnType<typeof useParticipants>, 'getParticipantById' | 'getFirstUserCharacter' | 'getFirstCharacter'>
}) {
  // --- Avatar generation watch ---
  // After triggering avatar generation, watch for the participant's avatar URL
  // to change and then refresh the chat.
  //
  // The live signal is a `chats:<id>` hint, published when the
  // CHARACTER_AVATAR_GENERATION job's writes commit — normally the very first
  // check finds the new avatar. The interval is the fallback for a dropped
  // socket, and the expiry keeps a failed generation from watching forever.
  const [avatarWatch, setAvatarWatch] = useState<
    { characterId: string; snapshotAvatarUrl: string | null; expiresAt: number } | null
  >(null)

  const checkAvatarUpdate = useCallback(async (watch: {
    characterId: string
    snapshotAvatarUrl: string | null
  }) => {
    try {
      const res = await fetch(`/api/v1/chats/${id}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      // Check the enriched participant avatar URL — this changes when avatarOverrides update
      const updatedParticipant = data.chat?.participants?.find(
        (p: { character?: { id?: string } }) => p.character?.id === watch.characterId
      )
      const newAvatarUrl = updatedParticipant?.character?.avatarUrl ?? null
      if (newAvatarUrl && newAvatarUrl !== watch.snapshotAvatarUrl) {
        setAvatarWatch(null)
        await fetchChat()
        showInfoToast('Avatar updated')
      }
    } catch {
      // Silently keep watching.
    }
  }, [id, fetchChat])

  const startAvatarPoll = useCallback((characterId: string) => {
    // Snapshot the current avatar URL for this character to detect when it changes
    const participant = chat?.participants.find(p => p.character?.id === characterId)
    setAvatarWatch({
      characterId,
      snapshotAvatarUrl: participant?.character?.avatarUrl ?? null,
      expiresAt: Date.now() + AVATAR_WATCH_TIMEOUT_MS,
    })
  }, [chat?.participants])

  useRealtimeTopic('chats', () => {
    if (avatarWatch) void checkAvatarUpdate(avatarWatch)
  }, id)

  useRealtimeFallbackPoll(
    () => { if (avatarWatch) void checkAvatarUpdate(avatarWatch) },
    AVATAR_POLL_INTERVAL_MS,
    avatarWatch != null,
  )

  useEffect(() => {
    if (!avatarWatch) return
    const timer = setTimeout(
      () => setAvatarWatch(null),
      Math.max(0, avatarWatch.expiresAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [avatarWatch])

  const handleRegenerateAvatar = useCallback(async (participantId: string) => {
    const participant = chat?.participants.find(p => p.id === participantId)
    const characterId = participant?.character?.id
    const name = participant?.character?.name || 'Unknown'
    if (!characterId) return
    try {
      const res = await fetch(`/api/v1/chats/${id}?action=regenerate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      })
      if (res.ok) {
        showInfoToast(`Avatar regeneration queued for ${name}`)
        startAvatarPoll(characterId)
      } else {
        const data = await res.json().catch(() => ({}))
        showErrorToast(data.error || 'Failed to regenerate avatar')
      }
    } catch {
      showErrorToast('Failed to regenerate avatar')
    }
  }, [chat?.participants, id, startAvatarPoll])

  // The chat's avatar timeline: each bubble shows its author as they looked
  // when it was written (lib/chat/salon-avatar.ts). Rides the `chats`
  // realtime topic; the interval is only the offline fallback.
  const avatarTimelineRefetch = useRealtimeRefetchInterval(AVATAR_TIMELINE_FALLBACK_POLL_MS)
  const avatarTimelineQuery = useQuery({
    queryKey: queryKeys.chats.avatarTimeline(id),
    queryFn: ({ signal }) =>
      apiFetch<{ data: SalonAvatarSegment[] }>(`/api/v1/chats/${id}?action=avatar-timeline`, { signal }),
    enabled: Boolean(id),
    refetchInterval: avatarTimelineRefetch,
  })
  const avatarTimelineIndex = useMemo(
    () => indexAvatarTimeline(avatarTimelineQuery.data?.data ?? []),
    [avatarTimelineQuery.data],
  )

  /**
   * A character's face at the moment of one message. When the timeline
   * answers, its URL stands alone (the enriched `defaultImage` would win in
   * `<Avatar>` and carries the chat's current look). Otherwise the
   * character's current avatar, exactly as before the timeline existed.
   */
  const faceAt = useCallback((
    character: { id: string; avatarUrl?: string | null; defaultImage?: CharacterData['defaultImage'] | null },
    message: Message,
  ): { avatarUrl: string | null; defaultImage: CharacterData['defaultImage'] | null } => {
    const answer = avatarAt(avatarTimelineIndex, character.id, message.createdAt, character.avatarUrl ?? null)
    if (answer.from === 'character-current') {
      return { avatarUrl: character.avatarUrl ?? null, defaultImage: character.defaultImage ?? null }
    }
    return { avatarUrl: answer.url, defaultImage: null }
  }, [avatarTimelineIndex])

  // Read off the chat once, so the memo below names exactly what it uses.
  const chatParticipants = chat?.participants
  const offSceneCharacters = chat?.offSceneCharacters
  const chatUser = chat?.user

  const getMessageAvatar = useCallback((message: Message) => {
    // Ad-hoc announcement bubble (Insert Announcement composer button), or a
    // Pascal outcome its tool has the rolling character announce
    // (`announceAsCharacter`). customAnnouncer takes precedence over
    // systemSender: when both are set, the named speaker wears the bubble.
    if (message.customAnnouncer) {
      if (message.customAnnouncer.kind === 'character' && message.customAnnouncer.characterId) {
        const charId = message.customAnnouncer.characterId
        const participant = chatParticipants?.find(p => p.character?.id === charId)
        if (participant?.character) {
          return {
            name: participant.character.name,
            characterId: participant.character.id,
            title: participant.character.title ?? null,
            ...faceAt(participant.character, message),
          }
        }
        const offScene = offSceneCharacters?.find(c => c.id === charId)
        if (offScene) {
          return {
            name: offScene.name,
            title: offScene.title,
            avatarUrl: offScene.avatarUrl,
            defaultImage: null,
          }
        }
        // Character no longer exists; render with a placeholder name so the
        // bubble is still legible.
        return { name: 'Off-scene character', title: null, avatarUrl: null, defaultImage: null }
      }
      if (message.customAnnouncer.kind === 'custom') {
        return {
          name: message.customAnnouncer.displayName || 'Announcement',
          title: null,
          avatarUrl: null,
          defaultImage: null,
        }
      }
    }
    // Staff-authored messages render with the member's own name and face,
    // from the one table in lib/chat/staff-display-names.ts. Carina (null
    // there) and an unrecognised sender fall through.
    const staff = staffAvatar(message.systemSender)
    if (staff) {
      return { ...staff, defaultImage: null }
    }
    // Carina (inline LLM queries): a reference answer renders with the ANSWERER
    // character's own avatar — there is no dedicated Carina staff avatar. Resolve
    // them via carinaMeta.answererId among participants, then off-scene cards,
    // then a legible placeholder.
    if (message.systemSender === 'carina') {
      const answererId = message.carinaMeta?.answererId
      // The Brahma Console pseudocharacter has no character record; render its
      // reference card with the dedicated Brahma name + avatar.
      if (answererId === BRAHMA_CARINA_ANSWERER_ID) {
        return { name: 'Brahma', title: null, avatarUrl: '/images/avatars/brahma-avatar.webp', defaultImage: null }
      }
      if (answererId) {
        const participant = chatParticipants?.find(p => p.character?.id === answererId)
        if (participant?.character) {
          return {
            name: participant.character.name,
            characterId: participant.character.id,
            title: participant.character.title ?? null,
            ...faceAt(participant.character, message),
          }
        }
        const offScene = offSceneCharacters?.find(c => c.id === answererId)
        if (offScene) {
          return { name: offScene.name, title: offScene.title, avatarUrl: offScene.avatarUrl, defaultImage: null }
        }
      }
      return { name: 'Carina', title: null, avatarUrl: null, defaultImage: null }
    }
    if (message.participantId) {
      const participant = participants.getParticipantById(message.participantId)
      if (participant) {
        if (participant.type === 'CHARACTER' && participant.character) {
          return { name: participant.character.name, characterId: participant.character.id, title: participant.character.title, ...faceAt(participant.character, message) }
        }
      }
    }
    if (message.role === 'USER') {
      const userChar = participants.getFirstUserCharacter()
      if (userChar) {
        return { name: userChar.name, characterId: userChar.id, title: userChar.title, ...faceAt(userChar, message) }
      } else if (chatUser) {
        return { name: chatUser.name || 'User', title: null, avatarUrl: chatUser.image ?? null, defaultImage: null }
      }
    } else if (message.role === 'ASSISTANT') {
      const character = participants.getFirstCharacter()
      if (character) {
        return { name: character.name, characterId: character.id, title: character.title, ...faceAt(character, message) }
      }
    }
    return null
  }, [participants, chatUser, chatParticipants, offSceneCharacters, faceAt])

  return { handleRegenerateAvatar, getMessageAvatar }
}
