/**
 * Shared shaping + helpers for the ChatCard data flow on both the Salon
 * list (`app/salon/page.tsx`) and the Character "Conversations" tab
 * (`components/character/character-conversations-tab.tsx`). The two pages
 * receive different chat shapes from the API and need different fields in
 * the resulting card — keep them as two named transforms so each call site
 * keeps its static guarantees.
 */

import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { ChatCardData } from '@/components/chat/ChatCard'
import type { ConciergeProvenance, ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import type { ConciergeModeReason } from '@/lib/schemas/chat.types'

// ----------------------------------------------------------------------------
// Salon list — chats with full participant + project metadata
// ----------------------------------------------------------------------------

interface SalonChatParticipantShape {
  id: string
  type: 'CHARACTER'
  characterId?: string | null
  isActive: boolean
  displayOrder: number
  character?: {
    id: string
    name: string
    avatarUrl?: string
    defaultImageId?: string
    defaultImage?: { id: string; filepath: string; url?: string }
    tags?: string[]
  }
}

export interface SalonChatShape {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  participants: SalonChatParticipantShape[]
  tags: Array<{ tag: { id: string; name: string } }>
  project: { id: string; name: string; color: string | null } | null
  storyBackground: { id: string; filepath: string } | null
  conciergeState?: ConciergeState
  conciergeSetBy?: ConciergeProvenance
  conciergeReason?: ConciergeModeReason | null
  dangerCategories?: string[]
  chatType?: 'salon' | 'help' | 'autonomous' | 'brahma' | 'calliope'
  scriptoriumStatus?: 'none' | 'rendered' | 'embedded'
  _count: { messages: number; memories?: number }
}

export function transformSalonChatToCardData(chat: SalonChatShape): ChatCardData {
  const characters = chat.participants
    .filter(p => p.type === 'CHARACTER' && p.isActive && p.character)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(p => ({
      id: p.character!.id,
      name: p.character!.name,
      avatarUrl: p.character!.avatarUrl,
      defaultImageId: p.character!.defaultImageId,
      defaultImage: p.character!.defaultImage,
      tags: p.character!.tags,
    }))

  return {
    id: chat.id,
    title: chat.title,
    messageCount: chat._count.messages,
    memoryCount: chat._count.memories ?? 0,
    participants: characters,
    tags: chat.tags,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    project: chat.project,
    storyBackgroundUrl: chat.storyBackground?.filepath || null,
    conciergeState: chat.conciergeState,
    conciergeSetBy: chat.conciergeSetBy,
    conciergeReason: chat.conciergeReason,
    dangerCategories: chat.dangerCategories,
    isAutonomous: chat.chatType === 'autonomous',
    scriptoriumStatus: chat.scriptoriumStatus ?? 'none',
  }
}

// ----------------------------------------------------------------------------
// Character Conversations tab — chats scoped to a single character
// ----------------------------------------------------------------------------

interface CharacterChatMessageShape {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  createdAt: string
}

export interface CharacterChatShape {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  lastMessageAt?: string
  userCharacter?: { id: string; name: string; title?: string | null } | null
  project?: { id: string; name: string } | null
  storyBackground?: { id: string; filepath: string } | null
  messages: CharacterChatMessageShape[]
  /** One plain line from the context summary (`summaryExcerpt`), as the home page's resume card shows */
  summaryExcerpt?: string | null
  tags?: Array<{ tag: { id: string; name: string } }>
  conciergeState?: ConciergeState
  conciergeSetBy?: ConciergeProvenance
  conciergeReason?: ConciergeModeReason | null
  dangerCategories?: string[]
  scriptoriumStatus?: 'none' | 'rendered' | 'embedded'
  _count?: { messages: number; memories?: number }
}

function getCharacterChatPreview(messages: CharacterChatMessageShape[]): string | null {
  const lastMessage = messages[messages.length - 1]
  if (!lastMessage) return null
  const content = lastMessage.content.replace(/\n/g, ' ').trim()
  return content.length > 100 ? content.slice(0, 100) + '...' : content
}

export function transformCharacterChatToCardData(chat: CharacterChatShape): ChatCardData {
  return {
    id: chat.id,
    title: chat.title,
    messageCount: chat._count?.messages ?? chat.messages.length,
    memoryCount: chat._count?.memories ?? 0,
    // No participants for character view — avatars not shown
    participants: [],
    tags: chat.tags,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    lastMessageAt: chat.lastMessageAt,
    project: chat.project || null,
    userCharacter: chat.userCharacter || null,
    // Where things stand, from the context summary; a chat too young to have
    // one falls back to its latest line.
    previewText: chat.summaryExcerpt || getCharacterChatPreview(chat.messages),
    storyBackgroundUrl: chat.storyBackground?.filepath || null,
    conciergeState: chat.conciergeState,
    conciergeSetBy: chat.conciergeSetBy,
    conciergeReason: chat.conciergeReason,
    dangerCategories: chat.dangerCategories,
    scriptoriumStatus: chat.scriptoriumStatus || 'none',
  }
}

// ----------------------------------------------------------------------------
// Delete confirmation + DELETE request
// ----------------------------------------------------------------------------

/**
 * Confirm deletion with the user, DELETE the chat, and return whether the
 * delete succeeded. Surfaces failures via toast. Callers own their list
 * refresh (query invalidation, local state update, etc.).
 */
export async function confirmAndDeleteChat(chatId: string): Promise<boolean> {
  const confirmed = await showConfirmation('Are you sure you want to delete this chat?')
  if (!confirmed) return false
  try {
    const res = await fetch(`/api/v1/chats/${chatId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete chat')
    return true
  } catch (err) {
    showErrorToast(err instanceof Error ? err.message : 'Failed to delete chat')
    return false
  }
}

// ----------------------------------------------------------------------------
// Re-extract memories confirmation + request
// ----------------------------------------------------------------------------

/** What the confirmation says, word for word, wherever the button is (#242). */
export const REEXTRACT_MEMORIES_CONFIRMATION =
  'This will delete the memories extracted from this chat and re-extract them from the conversation. Hand-written entries, archived entries and consolidated digests are kept. Are you sure?'

/**
 * Confirm, then ask the server to wipe and rebuild the chat's extracted
 * memories (`?action=reextract-memories`). The server refuses before touching
 * anything when the chat has no extraction profile or no turns, so a refusal
 * here leaves every memory where it was (#242). The Salon list, a character's
 * Conversations tab and the Salon sidebar all call this; none deletes on its
 * own. Returns whether the rebuild was queued.
 */
export async function confirmAndReextractChatMemories(chatId: string): Promise<boolean> {
  const confirmed = await showConfirmation(REEXTRACT_MEMORIES_CONFIRMATION)
  if (!confirmed) return false
  try {
    const data = await apiFetch<{ turnCount: number }>(
      `/api/v1/chats/${chatId}?action=reextract-memories`,
      { method: 'POST' },
    )
    showSuccessToast(`Re-extracting memories from ${data.turnCount} ${data.turnCount === 1 ? 'turn' : 'turns'}`)
    notifyQueueChange()
    return true
  } catch (err) {
    showErrorToast(apiErrorMessage(err, 'Failed to re-extract memories'))
    return false
  }
}
