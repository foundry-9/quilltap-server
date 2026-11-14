/**
 * Brahma Console Writing Assistant — context resolution.
 *
 * The one place a conversation's stored `consoleContext` (an ordered list of
 * `ConsoleContextRef`s) becomes something usable: names, ids, counts and the
 * real store names a model addresses with `qtap://`. It is a manifest, not a
 * pre-read and not a fence — nothing here reads any source's content, and the
 * Console's reach is unchanged.
 *
 * Character vaults are derived from the cast of each named conversation at
 * read time and never stored, so a cast change is picked up next turn. An
 * archived character is listed by name with no vault (the vault is a
 * tombstone). A ref whose target is gone is reported in `missing` and dropped
 * from the manifest with a `warn`; it is never an error.
 *
 * Server only.
 *
 * @module lib/brahma-console/writing-context
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { resolveOwnerStore, resolveProjectMountPointIds } from '@/lib/mount-index/reach'
import { resolveSpeakerNames } from '@/lib/chat/speaker-names'
import { memoryDateStamp } from '@/lib/memory/time/clock'
import { getMemoryTimeZone } from '@/lib/memory/time/calendar'
import { getErrorMessage } from '@/lib/error-utils'
import type { ConsoleContextRef } from '@/lib/schemas/chat.types'
import type { getRepositories } from '@/lib/repositories/factory'

const logger = createServiceLogger('BrahmaWritingContext')

type Repos = ReturnType<typeof getRepositories>

/** Chat types a conversation ref may name. */
export const CONTEXT_CHAT_TYPES = ['salon', 'autonomous'] as const

export interface ResolvedContextConversation {
  ref: { kind: 'chat'; id: string }
  title: string
  chatType: 'salon' | 'autonomous'
  messageCount: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  cast: Array<{ characterId: string; name: string; archived: boolean; vaultStoreName: string | null }>
}

export interface ResolvedConsoleContext {
  conversations: ResolvedContextConversation[]
  /** Every linked store, official first. */
  projects: Array<{ ref: { kind: 'project'; id: string }; name: string; storeNames: string[] }>
  /**
   * Stores named directly. `listedElsewhere` marks one the manifest already
   * lists through a conversation's vault or a project, so it appears once.
   */
  stores: Array<{ ref: { kind: 'store'; id: string }; name: string; listedElsewhere?: boolean }>
  general: { storeName: string } | null
  /** Character vaults derived from the conversations, de-duplicated by character. */
  characterVaults: Array<{ characterId: string; name: string; storeName: string; via: string[] }>
  /** Refs whose target no longer exists. */
  missing: ConsoleContextRef[]
}

export const EMPTY_CONSOLE_CONTEXT: ResolvedConsoleContext = Object.freeze({
  conversations: [],
  projects: [],
  stores: [],
  general: null,
  characterVaults: [],
  missing: [],
}) as unknown as ResolvedConsoleContext

/** A stable key for a ref, for de-duplication. */
export function contextRefKey(ref: ConsoleContextRef): string {
  return ref.kind === 'general' ? 'general' : `${ref.kind}:${ref.id}`
}

/** Drop repeated refs, keeping the first. */
export function dedupeContextRefs(refs: readonly ConsoleContextRef[]): ConsoleContextRef[] {
  const seen = new Set<string>()
  const out: ConsoleContextRef[] = []
  for (const ref of refs) {
    const key = contextRefKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

async function storeName(repos: Repos, mountPointId: string): Promise<string | null> {
  try {
    const mp = await repos.docMountPoints.findById(mountPointId)
    return mp?.name ?? null
  } catch (error) {
    logger.warn('Context store lookup failed', { mountPointId, error: getErrorMessage(error) })
    return null
  }
}

/**
 * Resolve a stored context. Never throws for a missing or broken target; that
 * ref lands in `missing`.
 */
export async function resolveConsoleContext(
  repos: Repos,
  userId: string,
  refs: readonly ConsoleContextRef[] | null | undefined,
): Promise<ResolvedConsoleContext> {
  const resolved: ResolvedConsoleContext = {
    conversations: [],
    projects: [],
    stores: [],
    general: null,
    characterVaults: [],
    missing: [],
  }
  const list = dedupeContextRefs(refs ?? [])
  if (list.length === 0) return resolved

  // Stores already listed (by id), so one named twice appears once.
  const listedStoreIds = new Set<string>()
  const vaultByCharacter = new Map<string, { characterId: string; name: string; storeName: string; storeId: string; via: string[] }>()
  let generalId: string | null = null
  const generalOwner = await resolveOwnerStore('general', null, repos, userId, { archived: 'allow', context: 'brahma-writing-context' })
  if (generalOwner) generalId = generalOwner.mountPointId

  const markMissing = (ref: ConsoleContextRef, reason: string) => {
    logger.warn('Writing Assistant context ref no longer resolves; dropped from the manifest', { ref, reason })
    resolved.missing.push(ref)
  }

  // Conversations first: their cast's vaults are listed ahead of the
  // projects and stores, so a store reached both ways keeps that place.
  for (const ref of list) {
    if (ref.kind !== 'chat') continue
    try {
      const chat = await repos.chats.findById(ref.id)
      if (!chat || chat.userId !== userId) { markMissing(ref, 'not found'); continue }
      if (!(CONTEXT_CHAT_TYPES as readonly string[]).includes(chat.chatType ?? 'salon')) {
        markMissing(ref, `chat type ${chat.chatType} is not a conversation`)
        continue
      }
      const names = await resolveSpeakerNames(chat)
      const cast: ResolvedContextConversation['cast'] = []
      const seenCharacters = new Set<string>()
      for (const p of chat.participants ?? []) {
        if (!p.characterId || seenCharacters.has(p.characterId)) continue
        seenCharacters.add(p.characterId)
        const name = names.get(p.id) ?? 'Unnamed character'
        let archived = false
        let vaultStoreName: string | null = null
        try {
          const owner = await resolveOwnerStore('character', p.characterId, repos, userId, {
            archived: 'allow',
            context: 'brahma-writing-context',
          })
          archived = !!owner?.character?.archivedAt
          if (owner && !archived) {
            vaultStoreName = await storeName(repos, owner.mountPointId)
            if (vaultStoreName) {
              const existing = vaultByCharacter.get(p.characterId)
              const via = chat.title || 'Untitled conversation'
              if (existing) {
                if (!existing.via.includes(via)) existing.via.push(via)
              } else {
                vaultByCharacter.set(p.characterId, {
                  characterId: p.characterId,
                  name,
                  storeName: vaultStoreName,
                  storeId: owner.mountPointId,
                  via: [via],
                })
              }
            }
          }
        } catch (error) {
          logger.warn('Context cast vault lookup failed; listing the name alone', {
            chatId: chat.id,
            characterId: p.characterId,
            error: getErrorMessage(error),
          })
        }
        cast.push({ characterId: p.characterId, name, archived, vaultStoreName })
      }
      const messageCount = chat.messageCount ?? 0
      resolved.conversations.push({
        ref: { kind: 'chat', id: chat.id },
        title: chat.title || 'Untitled conversation',
        chatType: (chat.chatType ?? 'salon') as 'salon' | 'autonomous',
        messageCount,
        firstMessageAt: messageCount > 0 ? chat.createdAt : null,
        lastMessageAt: chat.lastMessageAt ?? null,
        cast,
      })
    } catch (error) {
      markMissing(ref, getErrorMessage(error))
    }
  }

  for (const vault of vaultByCharacter.values()) {
    if (listedStoreIds.has(vault.storeId)) continue
    listedStoreIds.add(vault.storeId)
    resolved.characterVaults.push({
      characterId: vault.characterId,
      name: vault.name,
      storeName: vault.storeName,
      via: vault.via,
    })
  }

  for (const ref of list) {
    if (ref.kind !== 'project') continue
    try {
      const project = await repos.projects.findByIdRaw(ref.id)
      if (!project) { markMissing(ref, 'not found'); continue }
      const ids = await resolveProjectMountPointIds(project.id)
      const storeNames: string[] = []
      for (const id of ids) {
        if (listedStoreIds.has(id) || id === generalId) continue
        const name = await storeName(repos, id)
        if (!name) continue
        listedStoreIds.add(id)
        storeNames.push(name)
      }
      resolved.projects.push({ ref: { kind: 'project', id: project.id }, name: project.name, storeNames })
    } catch (error) {
      markMissing(ref, getErrorMessage(error))
    }
  }

  let wantsGeneral = false
  for (const ref of list) {
    if (ref.kind === 'general') { wantsGeneral = true; continue }
    if (ref.kind !== 'store') continue
    if (ref.id === generalId) { wantsGeneral = true; continue }
    const name = await storeName(repos, ref.id)
    if (!name) { markMissing(ref, 'not found'); continue }
    if (listedStoreIds.has(ref.id)) {
      resolved.stores.push({ ref: { kind: 'store', id: ref.id }, name, listedElsewhere: true })
      continue
    }
    listedStoreIds.add(ref.id)
    resolved.stores.push({ ref: { kind: 'store', id: ref.id }, name })
  }

  if (wantsGeneral) {
    const name = generalId ? await storeName(repos, generalId) : null
    if (name) {
      resolved.general = { storeName: name }
    } else {
      markMissing({ kind: 'general' }, 'Quilltap General is not available')
    }
  }

  logger.debug('Resolved Writing Assistant context', {
    refs: list.length,
    conversations: resolved.conversations.length,
    characterVaults: resolved.characterVaults.length,
    projects: resolved.projects.length,
    stores: resolved.stores.length,
    general: !!resolved.general,
    missing: resolved.missing.length,
  })
  return resolved
}

function quote(name: string): string {
  return `"${name.replace(/"/g, '\\"')}"`
}

/**
 * The manifest section for the system prompt: titles, ids, names and counts
 * only — never any source's content. Empty is absent: `''` when nothing
 * resolved, so the prompt gains nothing.
 */
export function renderConsoleContextManifest(
  resolved: ResolvedConsoleContext,
  timeZone: string = getMemoryTimeZone(),
): string {
  const sections: string[] = []

  if (resolved.conversations.length > 0) {
    const lines = ['### Conversations (read with read_messages / lookup_messages by chat id)']
    for (const c of resolved.conversations) {
      const first = memoryDateStamp(c.firstMessageAt, { timeZone })
      const last = memoryDateStamp(c.lastMessageAt, { timeZone })
      const span = first && last ? (first === last ? ` · ${first}` : ` · ${first} to ${last}`) : ''
      lines.push(`- ${quote(c.title)} — id ${c.ref.id} · ${c.messageCount} message${c.messageCount === 1 ? '' : 's'}${span}`)
      if (c.cast.length > 0) {
        lines.push(`  Cast: ${c.cast.map(m => (m.archived ? `${m.name} (archived)` : m.name)).join(', ')}`)
      }
    }
    sections.push(lines.join('\n'))
  }

  if (resolved.characterVaults.length > 0) {
    const lines = ['### Character vaults']
    for (const v of resolved.characterVaults) lines.push(`- ${v.name} — store ${quote(v.storeName)}`)
    sections.push(lines.join('\n'))
  }

  if (resolved.projects.length > 0) {
    const lines = ['### Projects']
    for (const p of resolved.projects) {
      lines.push(p.storeNames.length > 0
        ? `- ${quote(p.name)} — stores: ${p.storeNames.map(quote).join(', ')}`
        : `- ${quote(p.name)}`)
    }
    sections.push(lines.join('\n'))
  }

  const directStores = resolved.stores.filter(s => !s.listedElsewhere)
  if (directStores.length > 0) {
    const lines = ['### Document stores']
    for (const s of directStores) lines.push(`- ${quote(s.name)}`)
    sections.push(lines.join('\n'))
  }

  if (resolved.general) {
    sections.push(`### Quilltap General\n- store ${quote(resolved.general.storeName)}`)
  }

  if (sections.length === 0) return ''

  return [
    '## Sources for this piece',
    'The operator has named these sources. They are where the piece\'s facts, voices and conventions come from. You need not read them all: search, grep and read what the request calls for. You may look elsewhere when these do not answer the question.',
    ...sections,
  ].join('\n\n')
}
