'use client'

/**
 * The character page's save model (design of record:
 * `docs/developer/features/complete/aurora-character-page-unification.md` §4):
 * a control saves itself, a modal has a Save button, nothing else does.
 *
 * One {@link AutosaveEngine} per page holds the per-field drafts of the text
 * and prose fields and sends them as one-field (or coalesced) partial
 * `PUT /api/v1/characters/[id]` bodies; the immediate controls (selects,
 * toggles, stars, chips) go through {@link CharacterAutosave.saveNow} /
 * {@link CharacterAutosave.run}, which update the cache optimistically and
 * revert on failure. Both feed the one status chip in the header.
 *
 * Pending drafts are flushed when the workspace tab is hidden, when the
 * document is hidden, on unload (with `keepalive`) and on unmount, so nothing
 * typed is ever left behind by a navigation.
 *
 * Draft keys are the PUT's own field names, except the physical description's
 * text fields, which are `physicalDescription.<field>` — that record is sent
 * whole (its schema requires a name), merged over the stored one.
 *
 * @module app/aurora/[id]/hooks/useCharacterAutosave
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { AutosaveEngine, type AutosaveStatus } from '@/lib/autosave/autosave-engine'
import { useWorkspaceTabVisible } from '@/components/workspace/workspace-tab-context'
import { showErrorToast } from '@/lib/toast'
import type { Character, CharacterPhysicalDescription } from '../types'
import type { CharacterResponse } from './useCharacter'

/** Prefix of the physical description's draft keys. */
export const PHYSICAL_KEY_PREFIX = 'physicalDescription.'

/** The physical description's autosaved text fields. */
export const PHYSICAL_TEXT_FIELDS = [
  'headAndShouldersPrompt',
  'shortPrompt',
  'mediumPrompt',
  'longPrompt',
  'completePrompt',
  'fullDescription',
] as const
export type PhysicalTextField = (typeof PHYSICAL_TEXT_FIELDS)[number]

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  title: 'Title',
  identity: 'Identity',
  description: 'Description',
  manifesto: 'Manifesto',
  personality: 'Personality',
  firstMessage: 'First message',
  exampleDialogues: 'Example dialogues',
  pronouns: 'Pronouns',
  birthday: 'Birthday',
  'physicalDescription.headAndShouldersPrompt': 'Head & shoulders prompt',
  'physicalDescription.shortPrompt': 'Short prompt',
  'physicalDescription.mediumPrompt': 'Medium prompt',
  'physicalDescription.longPrompt': 'Long prompt',
  'physicalDescription.completePrompt': 'Complete prompt',
  'physicalDescription.fullDescription': 'Full description',
}

export function characterFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

/** Why a draft may not be sent yet, or null. */
export function validateCharacterDraft(key: string, value: unknown): string | null {
  if (key === 'name' && (typeof value !== 'string' || value.trim() === '')) {
    return 'A character must have a name.'
  }
  return null
}

/**
 * Turn engine drafts into the PUT body plus the patch to fold into the cached
 * row. Pure, for tests.
 */
export function buildCharacterPatch(
  drafts: Record<string, unknown>,
  stored: Character | null,
): { body: Record<string, unknown>; cachePatch: Partial<Character> } {
  const body: Record<string, unknown> = {}
  const physical: Partial<Record<PhysicalTextField, string>> = {}
  let touchesPhysical = false
  for (const [key, value] of Object.entries(drafts)) {
    if (key.startsWith(PHYSICAL_KEY_PREFIX)) {
      physical[key.slice(PHYSICAL_KEY_PREFIX.length) as PhysicalTextField] = value as string
      touchesPhysical = true
    } else if (key === 'name' || key === 'title') {
      body[key] = typeof value === 'string' ? value.trim() : value
    } else {
      body[key] = value
    }
  }
  if (touchesPhysical) {
    body.physicalDescription = mergePhysicalDescription(stored?.physicalDescription ?? null, physical)
  }
  return { body, cachePatch: body as Partial<Character> }
}

/** The whole physical description record, with `changes` laid over the stored one. */
export function mergePhysicalDescription(
  stored: CharacterPhysicalDescription | null,
  changes: Partial<Record<PhysicalTextField, string>> & { humanoid?: boolean },
): CharacterPhysicalDescription {
  const pick = (field: PhysicalTextField): string | null => {
    const value = field in changes ? changes[field] : stored?.[field]
    return value ? value : null
  }
  return {
    id: stored?.id ?? crypto.randomUUID(),
    headAndShouldersPrompt: pick('headAndShouldersPrompt'),
    shortPrompt: pick('shortPrompt'),
    mediumPrompt: pick('mediumPrompt'),
    longPrompt: pick('longPrompt'),
    completePrompt: pick('completePrompt'),
    fullDescription: pick('fullDescription'),
    humanoid: changes.humanoid ?? stored?.humanoid !== false,
  }
}

async function putCharacter(
  characterId: string,
  body: Record<string, unknown>,
  keepalive = false,
): Promise<void> {
  const res = await fetch(`/api/v1/characters/${characterId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || 'The character could not be saved.')
  }
}

const LIST_FIELDS = new Set(['name', 'title', 'aliases', 'npc', 'controlledBy', 'isFavorite', 'kind', 'tags'])

export interface CharacterAutosave {
  engine: AutosaveEngine
  /**
   * An immediate control's one-field (or few-field) save: optimistic, reverted
   * and toasted on failure. Resolves true when it landed.
   */
  saveNow: (patch: Partial<Character>, failureMessage: string) => Promise<boolean>
  /**
   * Run any other write (an action route, a sub-resource) under the shared
   * status. Errors are toasted with `failureMessage` (or the error's own) and
   * swallowed; resolves the result, or undefined on failure.
   */
  run: <T>(fn: () => Promise<T>, failureMessage: string) => Promise<T | undefined>
  /** Merge a server-confirmed change into the cached row. */
  patchCache: (patch: Partial<Character>) => void
  /** Send every pending draft now (before a generator writes, say). */
  flush: () => Promise<void>
}

export function useCharacterAutosave(characterId: string): CharacterAutosave {
  const queryClient = useQueryClient()
  const detailKey = useMemo(() => queryKeys.characters.detail(characterId), [characterId])

  const patchCache = useCallback(
    (patch: Partial<Character>) => {
      queryClient.setQueryData<CharacterResponse>(detailKey, (prev) =>
        prev ? { ...prev, character: { ...prev.character, ...patch } } : prev,
      )
      if (Object.keys(patch).some((key) => LIST_FIELDS.has(key))) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.characters.all,
          predicate: (q) => q.queryKey[1] === 'list',
        })
      }
    },
    [queryClient, detailKey],
  )

  const [engine] = useState(
    () =>
      new AutosaveEngine({
        labelFor: characterFieldLabel,
        validate: validateCharacterDraft,
        save: async (drafts, { keepalive }) => {
          // The cache, not a render's copy: a save that just landed has
          // already been folded in there.
          const stored =
            queryClient.getQueryData<CharacterResponse>(queryKeys.characters.detail(characterId))?.character ?? null
          const { body, cachePatch } = buildCharacterPatch(drafts, stored)
          console.debug('[CharacterPage] autosave', { characterId, fields: Object.keys(body), keepalive })
          try {
            await putCharacter(characterId, body, keepalive)
          } catch (err) {
            console.warn('[CharacterPage] autosave failed', {
              characterId,
              fields: Object.keys(body),
              error: err instanceof Error ? err.message : String(err),
            })
            throw err
          }
          patchCache(cachePatch)
        },
      }),
  )

  const saveNow = useCallback(
    async (patch: Partial<Character>, failureMessage: string): Promise<boolean> => {
      const previous = queryClient.getQueryData<CharacterResponse>(detailKey)
      patchCache(patch)
      try {
        await engine.runImmediate(() => putCharacter(characterId, patch as Record<string, unknown>))
        console.debug('[CharacterPage] saved', { characterId, fields: Object.keys(patch) })
        return true
      } catch (err) {
        if (previous) queryClient.setQueryData(detailKey, previous)
        void queryClient.invalidateQueries({ queryKey: detailKey })
        showErrorToast(err instanceof Error && err.message ? err.message : failureMessage)
        console.warn('[CharacterPage] save failed', {
          characterId,
          fields: Object.keys(patch),
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      }
    },
    [queryClient, detailKey, patchCache, engine, characterId],
  )

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, failureMessage: string): Promise<T | undefined> => {
      try {
        return await engine.runImmediate(fn)
      } catch (err) {
        showErrorToast(err instanceof Error && err.message ? err.message : failureMessage)
        console.warn('[CharacterPage] action failed', {
          characterId,
          error: err instanceof Error ? err.message : String(err),
        })
        return undefined
      }
    },
    [engine, characterId],
  )

  const flush = useCallback(() => engine.flush(), [engine])

  // Leaving the page in any way sends what is pending.
  const tabVisible = useWorkspaceTabVisible()
  useEffect(() => {
    if (!tabVisible) void engine.flush()
  }, [tabVisible, engine])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void engine.flush({ keepalive: true })
    }
    const onPageHide = () => {
      void engine.flush({ keepalive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      // Flush only: the engine outlives a Strict Mode remount, so its
      // subscribers must survive this cleanup.
      void engine.flush()
    }
  }, [engine])

  return useMemo(
    () => ({ engine, saveNow, run, patchCache, flush }),
    [engine, saveNow, run, patchCache, flush],
  )
}

/** The page-wide save status, for the header chip. */
export function useAutosaveStatus(engine: AutosaveEngine): AutosaveStatus {
  return useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus)
}

/** One field's draft, failure and validation state. */
export function useAutosaveFieldState(engine: AutosaveEngine, key: string) {
  const subscribe = engine.subscribe
  const hasDraft = useSyncExternalStore(subscribe, () => engine.hasDraft(key), () => false)
  const draft = useSyncExternalStore(subscribe, () => engine.draftOf(key), () => undefined)
  const failed = useSyncExternalStore(subscribe, () => engine.hasFailed(key), () => false)
  const invalid = useSyncExternalStore(subscribe, () => engine.invalidReason(key), () => null)
  return { hasDraft, draft, failed, invalid }
}
