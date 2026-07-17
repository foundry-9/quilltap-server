'use client'

/**
 * WorkspaceIntent
 *
 * Consumes a transient `?open=` intent on the `/workspace` URL — opening (or
 * focusing) the requested tab — then strips the params so the resting URL is a
 * clean `/workspace`. This is the target the old per-surface routes redirect to
 * (Phase 6) and a convenient way to deep-link a tab.
 *
 * Examples:
 *   /workspace?open=aurora
 *   /workspace?open=salon&chatId=abc
 *   /workspace?open=settings&tab=system&section=memory
 *
 * @module components/workspace/WorkspaceIntent
 */

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useWorkspace } from '@/components/providers/workspace-provider'
import { standaloneDocKey, type DocumentStandaloneTabPayload, type TabKind } from '@/lib/workspace/types'

const OPENABLE_KINDS: ReadonlySet<TabKind> = new Set<TabKind>([
  'home',
  'salon',
  'terminal',
  'document',
  'aurora',
  'prospero',
  'scriptorium',
  'settings',
  'files',
  'photos',
  'scenarios',
  'brahma',
  'wardrobe',
  'profile',
  'about',
  'generate-image',
  'document-standalone',
  'character-new',
  'character-edit',
  'settings-wizard',
  'custom-tools',
])

const CHAT_KINDS: ReadonlySet<TabKind> = new Set<TabKind>(['salon', 'terminal', 'document'])

export function WorkspaceIntent() {
  const { openTab, hydrated } = useWorkspace()
  const router = useRouter()
  const searchParams = useSearchParams()
  const handledRef = useRef(false)

  useEffect(() => {
    // Wait for localStorage hydration first: applying the intent before the
    // provider's hydrate effect runs would let the subsequent REPLACE_STATE
    // clobber the just-opened tab (effects run child-first).
    if (!hydrated) return
    const open = searchParams.get('open')
    if (!open || handledRef.current) return
    handledRef.current = true

    const kind = open as TabKind
    if (OPENABLE_KINDS.has(kind)) {
      const chatId = searchParams.get('chatId') || undefined
      const tab = searchParams.get('tab') || undefined
      const section = searchParams.get('section') || undefined
      const characterId = searchParams.get('characterId') || undefined

      let payload: unknown
      if (CHAT_KINDS.has(kind)) payload = chatId ? { chatId } : undefined
      else if (kind === 'settings') payload = { tab, section }
      else if (kind === 'custom-tools') {
        const mountPointId = searchParams.get('mount') || undefined
        const path = searchParams.get('path') || undefined
        const create = searchParams.get('new') === '1' || undefined
        payload = mountPointId || path || create ? { mountPointId, path, create } : undefined
      }
      else if (kind === 'wardrobe') payload = characterId ? { characterId } : undefined
      else if (kind === 'character-edit') payload = characterId ? { characterId, tab } : undefined
      else if (kind === 'document-standalone') {
        // Standalone Document Mode deep-link (the sidebar's legacy-shell path).
        const scope: DocumentStandaloneTabPayload['scope'] =
          searchParams.get('scope') === 'document_store' ? 'document_store' : 'general'
        const filePath = searchParams.get('filePath') || undefined
        const mountPoint = searchParams.get('mountPoint') || undefined
        const targetFolder = searchParams.get('targetFolder') || undefined
        payload = {
          docKey: standaloneDocKey(scope, mountPoint ?? null, filePath),
          scope,
          mountPoint: mountPoint ?? null,
          filePath,
          targetFolder,
        } satisfies DocumentStandaloneTabPayload
      }

      // Chat-bound kinds need a chatId and the character editor needs a
      // characterId; skip opening when the required id is missing.
      const missingChatId = CHAT_KINDS.has(kind) && !chatId
      const missingCharacterId = kind === 'character-edit' && !characterId
      if (!missingChatId && !missingCharacterId) {
        openTab(kind, payload)
      }
    }

    // Strip the intent params; keep the resting URL clean.
    router.replace('/workspace')
  }, [hydrated, searchParams, openTab, router])

  return null
}
