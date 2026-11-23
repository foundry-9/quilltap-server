/**
 * The research kit's record lookups (research kit §5.5–§5.7). Operator surface
 * only (`OPERATOR_SURFACE_ONLY_TOOLS`): they read every conversation and every
 * character.
 *
 *  - `lookupConversations` — which conversation, by title or summary words,
 *    participant and date window; or one in full (summary and an outline).
 *  - `lookupGroup` / `lookupProject` — instructions, store outline and every
 *    member (or the roster) as one line each.
 *  - `lookupWardrobe` — what a character can wear (`loadWearablePool`) or one
 *    tier's rail (`resolveWardrobeLocation`).
 *  - `lookupAtlas` — an entry by name, or a tier's names
 *    (`resolveAtlasLocation` per tier; names folded as `lib/atlas/match.ts`
 *    folds them).
 *
 * Raw rows where only a name or pointer is wanted; a broken vault is listed as
 * such, never dropped. Participant names through `resolveSpeakerNames`.
 * Every result is cut under the kit's soft ceiling at a record boundary.
 *
 * @module lib/research/records
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadata } from '@/lib/schemas/types'
import { isCharacterAuthoredMessage } from '@/lib/chat/chat-activity'
import { resolveSpeakerNames, speakerLabel } from '@/lib/chat/speaker-names'
import { zonedDayBoundsIso } from '@/lib/memory/time/calendar'
import { refreshMemoryTimeZone } from '@/lib/memory/time/calendar-refresh'
import { resolveOwnerStore, resolveProjectMountPointIds, type OwnerScope } from '@/lib/mount-index/reach'
import { buildDocStoreUriResolver } from '@/lib/doc-edit/uri-producers'
import { loadWearablePool } from '@/lib/wardrobe/pool'
import { resolveWardrobeLocation } from '@/lib/wardrobe/location'
import { resolveWardrobeInstructions } from '@/lib/wardrobe/wardrobe-instructions'
import { wardrobeItemOwnPath } from '@/lib/wardrobe/vault-parsers'
import { resolveAtlasLocation, type AtlasLocation } from '@/lib/atlas/location'
import { atlasTermsOf, foldAtlasTerm } from '@/lib/atlas/match'
import type { AtlasRecord } from '@/lib/schemas/atlas.types'
import { resolveCharacterRef } from './characters'
import { CONVERSATION_CHAT_TYPES, resolveConversationRef } from './conversations'
import type { ResearchOutcome } from './documents'
import { storeAddress, storeOutline } from './outline'
import { RESEARCH_RESULT_CEILING, clipLine, dateOf, foldName, joinUnderCeiling, nearestByName } from './text'

const logger = createServiceLogger('ResearchRecords')

const SUMMARY_PREVIEW_CHARS = 300
/** Lines of a store outline shown inside a group or project lookup. */
const OUTLINE_LINES = 24
/** One outline line per this many spoken lines of a conversation. */
const OUTLINE_EVERY = 10

/** The first sentence of a text, clipped. */
export function firstSentence(text: string | null | undefined, max = 200): string {
  if (!text) return ''
  const flat = text.replace(/^#+\s.*$/gm, '').replace(/\s+/g, ' ').trim()
  const end = flat.search(/[.!?](\s|$)/)
  return clipLine(end >= 0 ? flat.slice(0, end + 1) : flat, max)
}

/** Date-only bounds widen to whole local days on the memory calendar. */
async function windowOf(since?: string, until?: string): Promise<{ from: string; to: string } | null> {
  if (!since && !until) return null
  const tz = await refreshMemoryTimeZone()
  const from = since
    ? (since.length === 10 ? zonedDayBoundsIso(since, tz)?.from ?? `${since}T00:00:00.000Z` : since)
    : '0000-01-01T00:00:00.000Z'
  const to = until
    ? (until.length === 10 ? zonedDayBoundsIso(until, tz)?.to ?? `${until}T23:59:59.999Z` : until)
    : '9999-12-31T23:59:59.999Z'
  return { from, to }
}

function lastActive(chat: ChatMetadata): string {
  return chat.lastMessageAt ?? chat.updatedAt ?? chat.createdAt
}

async function participantNames(chat: ChatMetadata): Promise<string[]> {
  try {
    return Array.from(new Set((await resolveSpeakerNames(chat)).values()))
  } catch {
    return []
  }
}

// ============================================================================
// lookup_conversations
// ============================================================================

export interface LookupConversationsQuery {
  query?: string
  character?: string
  since?: string
  until?: string
  conversation?: string
  limit?: number
}

export async function lookupConversations(q: LookupConversationsQuery): Promise<ResearchOutcome<{ count: number }>> {
  const repos = getRepositories()

  if (q.conversation) {
    const found = await resolveConversationRef(q.conversation)
    if (!found) return { ok: false, error: `No conversation with the id or title "${q.conversation}". Search with \`query\` instead.` }
    if ('ambiguous' in found) {
      return {
        ok: false,
        error: `More than one conversation is titled "${q.conversation}"; pass one of these ids: ${found.ambiguous
          .slice(0, 8)
          .map((c) => `${c.id} (${dateOf(c.createdAt)})`)
          .join(', ')}.`,
      }
    }
    return conversationInFull(found)
  }

  let chats: ChatMetadata[]
  if (q.character) {
    const match = await resolveCharacterRef(q.character)
    if (match.kind !== 'found') {
      return {
        ok: false,
        error: match.kind === 'ambiguous'
          ? `"${q.character}" matches more than one character: ${match.candidates.map((c) => `${c.name} (${c.id})`).join(', ')}.`
          : `No character matches "${q.character}".`,
      }
    }
    chats = await repos.chats.findByCharacterId(match.character.id)
  } else {
    chats = await repos.chats.findAll()
  }
  chats = chats.filter((c) => CONVERSATION_CHAT_TYPES.has(c.chatType ?? 'salon'))

  const window = await windowOf(q.since, q.until)
  if (window) {
    chats = chats.filter((c) => lastActive(c) >= window.from && (c.createdAt ?? '') <= window.to)
  }

  // Score by how many query words the title and summary hold; title words count double.
  const words = (q.query ?? '').split(/\s+/).map(foldName).filter((w) => w.length > 1)
  type Scored = { chat: ChatMetadata; score: number }
  let scored: Scored[] = chats.map((chat) => {
    if (words.length === 0) return { chat, score: 1 }
    const title = foldName(chat.title || '')
    const summary = foldName(chat.contextSummary || '')
    let score = 0
    for (const w of words) {
      if (title.includes(w)) score += 2
      else if (summary.includes(w)) score += 1
    }
    return { chat, score }
  })
  if (words.length > 0) scored = scored.filter((s) => s.score > 0)
  scored.sort((a, b) => b.score - a.score || lastActive(b.chat).localeCompare(lastActive(a.chat)))

  const limit = Math.min(Math.max(q.limit ?? 10, 1), 30)
  const top = scored.slice(0, limit)
  logger.debug('lookup_conversations completed', {
    candidates: chats.length,
    matched: scored.length,
    returned: top.length,
    windowed: !!window,
    words: words.length,
  })

  if (top.length === 0) {
    return {
      ok: true,
      text: `No conversation matches${q.query ? ` "${q.query}"` : ''}${q.character ? ` with ${q.character}` : ''}${window ? ' in that window' : ''}. Try lookup_messages for words spoken in it, or widen the dates.`,
      data: { count: 0 },
    }
  }

  const records: string[] = []
  for (const { chat } of top) {
    const names = await participantNames(chat)
    const summary = chat.contextSummary ? clipLine(chat.contextSummary.replace(/\s+/g, ' '), SUMMARY_PREVIEW_CHARS) : '(no summary yet)'
    records.push(
      `- "${chat.title || 'Untitled'}" (${chat.id}) — ${dateOf(chat.createdAt)} to ${dateOf(lastActive(chat))}, ` +
        `${chat.messageCount ?? 0} lines; with ${names.join(', ') || 'no named participants'}\n  ${summary}`,
    )
  }
  const head = `${top.length} of ${scored.length} conversation${scored.length === 1 ? '' : 's'}${scored.length > top.length ? ' (narrow with `character`, `since`/`until` or more words)' : ''}:`
  return {
    ok: true,
    text: joinUnderCeiling(head, records, {
      separator: '\n',
      tail: 'Read the one that fits with read_messages (conversation_id), or search inside it with lookup_messages (`conversation`).',
      omittedHint: (n) => `[${n} more left out for length; narrow the search.]`,
    }),
    data: { count: top.length },
  }
}

async function conversationInFull(chat: ChatMetadata): Promise<ResearchOutcome<{ count: number }>> {
  const repos = getRepositories()
  const names = await resolveSpeakerNames(chat)
  const lines = (await repos.chats.getMessages(chat.id)).filter(isCharacterAuthoredMessage)
  const outline: string[] = []
  for (let i = 0; i < lines.length; i += OUTLINE_EVERY) {
    const m = lines[i]
    const firstLine = (m.content ?? '').split('\n').find((l) => l.trim()) ?? ''
    outline.push(`  #${i} ${dateOf(m.createdAt)} ${speakerLabel(m, names)}: ${clipLine(firstLine, 160)}`)
  }
  logger.debug('lookup_conversations: one in full', { chatId: chat.id, spokenLines: lines.length, outline: outline.length })
  const head = [
    `"${chat.title || 'Untitled'}" (${chat.id})`,
    `${dateOf(chat.createdAt)} to ${dateOf(lastActive(chat))}; ${lines.length} spoken lines; with ${Array.from(new Set(names.values())).join(', ') || 'no named participants'}.`,
    '',
    'Summary:',
    chat.contextSummary?.trim() || '(no summary yet)',
    '',
    `Outline (the first line of every ${OUTLINE_EVERY}th spoken line; #N is its index for read_messages offset):`,
  ].join('\n')
  return {
    ok: true,
    text: joinUnderCeiling(head, outline, {
      separator: '\n',
      ceiling: 8000,
      omittedHint: (n) => `  [${n} more outline lines left out; read_messages with offset reads any part.]`,
    }),
    data: { count: 1 },
  }
}

// ============================================================================
// lookup_group / lookup_project
// ============================================================================

/** Find a group or project row by name (folded) or id; raw rows. */
async function findNamedRow<T extends { id: string; name: string }>(rows: T[], ref: string): Promise<T | { nearest: string[] }> {
  const needle = foldName(ref)
  const exact = rows.find((r) => r.id === ref.trim() || foldName(r.name) === needle)
  if (exact) return exact
  const partial = rows.filter((r) => foldName(r.name).includes(needle))
  if (partial.length === 1) return partial[0]
  return { nearest: nearestByName(ref, rows.map((r) => r.name), 3) }
}

async function storeLine(mountPointId: string, label: string): Promise<string[]> {
  const repos = getRepositories()
  const store = await repos.docMountPoints.findById(mountPointId).catch(() => null)
  if (!store) return [`${label}: (store ${mountPointId} is missing)`]
  const { fileCount, lines } = await storeOutline(mountPointId, 2)
  const shown = lines.slice(0, OUTLINE_LINES)
  return [
    `${label}: "${store.name}" (${fileCount} file${fileCount === 1 ? '' : 's'}; read a file at ${storeAddress(store)}<path>)`,
    ...shown.map((l) => `  ${l}`),
    ...(lines.length > shown.length ? [`  [${lines.length - shown.length} more lines; list_documents store="${store.name}"]`] : []),
  ]
}

/** One member line: name, title, first sentence of identity; a broken vault said so. */
async function memberLine(characterId: string): Promise<string> {
  const repos = getRepositories()
  const raw = await repos.characters.findByIdRaw(characterId).catch(() => null)
  if (!raw) return `- (character ${characterId} no longer exists)`
  const archived = raw.archivedAt ? ' [archived]' : ''
  try {
    const c = await repos.characters.findById(characterId)
    if (!c) return `- ${raw.name}${archived}`
    const title = c.title ? ` — ${c.title}` : ''
    const identity = firstSentence(c.identity)
    return `- ${c.name}${title}${archived}${identity ? `: ${identity}` : ''}`
  } catch (error) {
    logger.debug('Research member hydrate failed; listed as unreadable', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
    return `- ${raw.name}${archived}: (vault unreadable)`
  }
}

export async function lookupGroup(ref: string): Promise<ResearchOutcome<{ members: number }>> {
  const repos = getRepositories()
  const found = await findNamedRow(await repos.groups.findAllRaw(), ref)
  if ('nearest' in found) {
    return { ok: false, error: `No group matches "${ref}".${found.nearest.length ? ` Nearest: ${found.nearest.map((n) => `"${n}"`).join(', ')}.` : ''}` }
  }
  let instructions: string | null = null
  let description: string | null = null
  try {
    const group = await repos.groups.findById(found.id)
    instructions = group?.instructions ?? null
    description = group?.description ?? null
  } catch (error) {
    logger.debug('lookup_group: group store unreadable', { groupId: found.id, error: error instanceof Error ? error.message : String(error) })
  }
  const members = await repos.groupCharacterMembers.findByGroupId(found.id)
  const memberLines: string[] = []
  for (const m of members) memberLines.push(await memberLine(m.characterId))
  const store = found.officialMountPointId ? await storeLine(found.officialMountPointId, 'Store') : ['Store: (none)']
  logger.debug('lookup_group completed', { groupId: found.id, members: members.length })

  const head = [
    `Group "${found.name}" (${found.id})`,
    description ? `Description: ${clipLine(description.replace(/\s+/g, ' '), 600)}` : null,
    instructions ? `Instructions: ${clipLine(instructions.replace(/\s+/g, ' '), 1200)}` : 'Instructions: (none)',
    `Members (${members.length}):`,
  ].filter((l): l is string => l !== null).join('\n')
  // Members first (what a group lookup is mostly for), then the store, which
  // is always shown: the members share the ceiling with it.
  const storeText = store.join('\n')
  const roster = joinUnderCeiling(head, memberLines, {
    separator: '\n',
    ceiling: RESEARCH_RESULT_CEILING - storeText.length - 1,
    tail: members.length > 0 ? 'That is every member.' : 'The group has no members.',
    omittedHint: (n) => `[${n} more members left out for length; lookup_character on any one.]`,
  })
  return {
    ok: true,
    text: `${roster}\n${storeText}`,
    data: { members: members.length },
  }
}

export async function lookupProject(ref: string): Promise<ResearchOutcome<{ conversations: number }>> {
  const repos = getRepositories()
  const found = await findNamedRow(await repos.projects.findAllRaw(), ref)
  if ('nearest' in found) {
    return { ok: false, error: `No project matches "${ref}".${found.nearest.length ? ` Nearest: ${found.nearest.map((n) => `"${n}"`).join(', ')}.` : ''}` }
  }
  let project: Awaited<ReturnType<typeof repos.projects.findById>> = null
  try {
    project = await repos.projects.findById(found.id)
  } catch (error) {
    logger.debug('lookup_project: project store unreadable', { projectId: found.id, error: error instanceof Error ? error.message : String(error) })
  }
  const rosterLine = project?.allowAnyCharacter
    ? 'Roster: any character may take part.'
    : `Roster (${project?.characterRoster?.length ?? 0}):`
  const roster: string[] = []
  if (project && !project.allowAnyCharacter) {
    for (const id of project.characterRoster ?? []) roster.push(await memberLine(id))
  }
  const storeIds = await resolveProjectMountPointIds(found.id)
  const stores: string[] = []
  for (let i = 0; i < storeIds.length; i++) {
    stores.push(...(await storeLine(storeIds[i], i === 0 && storeIds[i] === found.officialMountPointId ? 'Official store' : 'Linked store')))
  }
  const chats = (await repos.chats.findAll())
    .filter((c) => c.projectId === found.id && CONVERSATION_CHAT_TYPES.has(c.chatType ?? 'salon'))
    .sort((a, b) => lastActive(b).localeCompare(lastActive(a)))
  const recent = chats.slice(0, 10).map((c) => `- "${c.title || 'Untitled'}" (${c.id}) — ${dateOf(c.createdAt)} to ${dateOf(lastActive(c))}, ${c.messageCount ?? 0} lines`)
  logger.debug('lookup_project completed', { projectId: found.id, stores: storeIds.length, conversations: chats.length })

  const parts = [
    `Project "${found.name}" (${found.id})`,
    project?.description ? `Description: ${clipLine(project.description.replace(/\s+/g, ' '), 600)}` : 'Description: (none)',
    project?.instructions ? `Instructions: ${clipLine(project.instructions.replace(/\s+/g, ' '), 1200)}` : 'Instructions: (none)',
    rosterLine,
    ...roster,
    ...(stores.length ? stores : ['Stores: (none)']),
    `Conversations: ${chats.length}${recent.length ? '; most recent:' : ''}`,
    ...recent,
  ]
  return {
    ok: true,
    text: joinUnderCeiling(parts[0], parts.slice(1), {
      separator: '\n',
      omittedHint: (n) => `[${n} more lines left out for length; list_documents or lookup_conversations for the rest.]`,
    }),
    data: { conversations: chats.length },
  }
}

// ============================================================================
// lookup_wardrobe
// ============================================================================

const TIER_SHORTHAND = /^(project|group)\s*:\s*(.+)$/i

export interface LookupWardrobeQuery {
  owner: string
  query?: string
  include_archived?: boolean
}

type WardrobeLine = { title: string; description: string | null; types: string[]; appropriateness: string | null; tier: string; uri: string; archived: boolean }

function wardrobeMatches(line: WardrobeLine, words: string[]): boolean {
  if (words.length === 0) return true
  const hay = foldName(`${line.title} ${line.description ?? ''} ${line.appropriateness ?? ''}`)
  return words.every((w) => hay.includes(w))
}

function renderWardrobe(head: string, lines: WardrobeLine[], words: string[]): string {
  const kept = lines.filter((l) => wardrobeMatches(l, words))
  // A narrowed result shows the full descriptions; a rail shows one line each.
  const full = kept.length <= 3
  const records = kept
    .sort((a, b) => a.tier.localeCompare(b.tier) || a.title.localeCompare(b.title))
    .map((l) => {
      const base = `- ${l.title}${l.archived ? ' [archived]' : ''} — ${l.types.join('+')}${l.appropriateness ? `; ${l.appropriateness}` : ''} (${l.tier}) ${l.uri}`
      return full && l.description ? `${base}\n  ${l.description.trim()}` : base
    })
  if (records.length === 0) {
    return `${head}\nNo pieces${words.length ? ` match "${words.join(' ')}"` : ''}.`
  }
  return joinUnderCeiling(`${head}\n${kept.length} piece${kept.length === 1 ? '' : 's'}:`, records, {
    separator: '\n',
    tail: full ? undefined : 'Read a piece in full with doc_read_file on its URI, or narrow with `query`.',
    omittedHint: (n) => `[${n} more pieces left out for length; narrow with \`query\`.]`,
  })
}

export async function lookupWardrobe(q: LookupWardrobeQuery, ctx: { userId: string }): Promise<ResearchOutcome<{ pieces: number }>> {
  const repos = getRepositories()
  const uris = await buildDocStoreUriResolver()
  const words = (q.query ?? '').split(/\s+/).map(foldName).filter((w) => w.length > 1)
  const storeNames = new Map<string, string>()
  const nameOfStore = async (mountPointId: string): Promise<string> => {
    if (!storeNames.has(mountPointId)) {
      const mp = await repos.docMountPoints.findById(mountPointId).catch(() => null)
      storeNames.set(mountPointId, mp?.name ?? '')
    }
    return storeNames.get(mountPointId) ?? ''
  }
  const uriFor = async (mountPointId: string | null, item: { title: string; folder?: string | null }) => {
    if (!mountPointId) return ''
    return uris.uriForMount(await nameOfStore(mountPointId), mountPointId, wardrobeItemOwnPath({ title: item.title, folder: item.folder ?? '' }))
  }

  const trimmed = q.owner.trim()
  const shorthand = TIER_SHORTHAND.exec(trimmed)
  if (shorthand || /^general$/i.test(trimmed)) {
    const scope = (shorthand ? shorthand[1].toLowerCase() : 'general') as 'project' | 'group' | 'general'
    let ownerId: string | null = null
    if (scope !== 'general') {
      const rows = scope === 'project' ? await repos.projects.findAllRaw() : await repos.groups.findAllRaw()
      const found = await findNamedRow(rows, shorthand![2])
      if ('nearest' in found) return { ok: false, error: `No ${scope} matches "${shorthand![2]}".` }
      ownerId = found.id
    }
    const location = await resolveWardrobeLocation(scope, ownerId, repos, ctx.userId)
    if (!location) return { ok: true, text: `${trimmed} has no wardrobe store yet.`, data: { pieces: 0 } }
    const items = await location.readItems(!!q.include_archived)
    const lines: WardrobeLine[] = []
    for (const item of items) {
      lines.push({
        title: item.title,
        description: item.description ?? null,
        types: item.types,
        appropriateness: item.appropriateness ?? null,
        tier: scope,
        uri: await uriFor(location.mountPointId, item),
        archived: !!item.archivedAt,
      })
    }
    logger.debug('lookup_wardrobe: tier rail', { scope, ownerId, items: items.length })
    return { ok: true, text: renderWardrobe(`The ${scope === 'general' ? 'Quilltap General' : `${scope} "${location.origin.name}"`} rail.`, lines, words), data: { pieces: lines.length } }
  }

  const match = await resolveCharacterRef(trimmed.replace(/^character\s*:\s*/i, ''))
  if (match.kind !== 'found') {
    return {
      ok: false,
      error: match.kind === 'ambiguous'
        ? `"${trimmed}" matches more than one character: ${match.candidates.map((c) => `${c.name} (${c.id})`).join(', ')}.`
        : `No character matches "${trimmed}". For a tier's rail use \`project:Name\`, \`group:Name\` or \`general\`.`,
    }
  }
  const character = match.character
  const pool = await loadWearablePool(repos, character.id, [], { operator: true })
  const items = q.include_archived ? Array.from(pool.byId.values()) : pool.wearable()

  // Each origin's store, once.
  const mountByOrigin = new Map<string, string | null>()
  const mountFor = async (origin: { scope: string; id: string | null }): Promise<string | null> => {
    const key = `${origin.scope}:${origin.id ?? ''}`
    if (!mountByOrigin.has(key)) {
      const owned = await resolveOwnerStore(origin.scope as OwnerScope, origin.id, repos, ctx.userId, { archived: 'allow', context: 'research' })
        .catch(() => null)
      mountByOrigin.set(key, owned?.mountPointId ?? null)
    }
    return mountByOrigin.get(key) ?? null
  }
  const lines: WardrobeLine[] = []
  for (const item of items) {
    const origin = item.origin.scope === 'character' ? { scope: 'character', id: character.id } : item.origin
    lines.push({
      title: item.title,
      description: item.description ?? null,
      types: item.types,
      appropriateness: item.appropriateness ?? null,
      tier: item.origin.scope === 'character' ? 'own' : `${item.origin.scope}${item.origin.name ? `: ${item.origin.name}` : ''}`,
      uri: await uriFor(await mountFor(origin), item),
      archived: !!item.archivedAt,
    })
  }
  const instructions = await resolveWardrobeInstructions({
    characterMountPointId: character.characterDocumentMountPointId ?? null,
    groupMountPointIds: pool.tiers.groupMountPointIds,
    projectMountPointIds: pool.tiers.projectMountPointIds,
  })
  logger.debug('lookup_wardrobe: character pool', { characterId: character.id, pieces: items.length, instructions: instructions?.tier ?? null })
  const head = [
    `${character.name}'s wardrobe (every piece they can reach).`,
    instructions ? `Dressing instructions (${instructions.tier}): ${clipLine(instructions.content.replace(/\s+/g, ' '), 1000)}` : 'Dressing instructions: (none)',
  ].join('\n')
  return { ok: true, text: renderWardrobe(head, lines, words), data: { pieces: lines.length } }
}

// ============================================================================
// lookup_atlas
// ============================================================================

export interface LookupAtlasQuery {
  name?: string
  owner?: string
}

/** Every Atlas tier in the instance (operator): General, projects, groups, live characters. */
async function everyAtlasLocation(userId: string): Promise<AtlasLocation[]> {
  const repos = getRepositories()
  const out: AtlasLocation[] = []
  const general = await resolveAtlasLocation('general', null, repos, userId)
  if (general) out.push(general)
  for (const p of await repos.projects.findAllRaw()) {
    const loc = await resolveAtlasLocation('project', p.id, repos, userId)
    if (loc) out.push(loc)
  }
  for (const g of await repos.groups.findAllRaw()) {
    const loc = await resolveAtlasLocation('group', g.id, repos, userId)
    if (loc) out.push(loc)
  }
  for (const c of await repos.characters.findAllRaw()) {
    if (c.archivedAt) continue
    const loc = await resolveAtlasLocation('character', c.id, repos, userId)
    if (loc) out.push(loc)
  }
  return out
}

async function atlasLocationsFor(owner: string | undefined, userId: string): Promise<AtlasLocation[] | { error: string }> {
  if (!owner || !owner.trim()) return everyAtlasLocation(userId)
  const repos = getRepositories()
  const trimmed = owner.trim()
  if (/^general$/i.test(trimmed)) {
    const loc = await resolveAtlasLocation('general', null, repos, userId)
    return loc ? [loc] : []
  }
  const m = /^(character|project|group)\s*:\s*(.+)$/i.exec(trimmed)
  if (!m) return { error: `\`owner\` is \`character:Name\`, \`project:Name\`, \`group:Name\` or \`general\`; got "${trimmed}".` }
  const scope = m[1].toLowerCase() as 'character' | 'project' | 'group'
  let id: string | null = null
  if (scope === 'character') {
    const match = await resolveCharacterRef(m[2])
    if (match.kind !== 'found') return { error: `No single character matches "${m[2]}".` }
    id = match.character.id
  } else {
    const rows = scope === 'project' ? await repos.projects.findAllRaw() : await repos.groups.findAllRaw()
    const found = await findNamedRow(rows, m[2])
    if ('nearest' in found) return { error: `No ${scope} matches "${m[2]}".` }
    id = found.id
  }
  const loc = await resolveAtlasLocation(scope, id, repos, userId)
  return loc ? [loc] : []
}

function tierLabel(loc: AtlasLocation): string {
  return loc.scope === 'general' ? 'Quilltap General' : `${loc.scope}: ${loc.origin.name}`
}

export async function lookupAtlas(q: LookupAtlasQuery, ctx: { userId: string }): Promise<ResearchOutcome<{ entries: number }>> {
  const locations = await atlasLocationsFor(q.owner, ctx.userId)
  if ('error' in locations) return { ok: false, error: locations.error }

  const tiers: Array<{ loc: AtlasLocation; entries: AtlasRecord[] }> = []
  for (const loc of locations) {
    try {
      const entries = await loc.readEntries(false)
      if (entries.length > 0) tiers.push({ loc, entries })
    } catch (error) {
      logger.warn('lookup_atlas: a tier could not be read', { mountPointId: loc.mountPointId, error: error instanceof Error ? error.message : String(error) })
    }
  }

  if (!q.name || !q.name.trim()) {
    const records = tiers.map(({ loc, entries }) => `- ${tierLabel(loc)} (${entries.length}): ${entries.map((e) => e.name).sort().join('; ')}`)
    logger.debug('lookup_atlas: names', { tiers: tiers.length })
    return {
      ok: true,
      text: records.length
        ? joinUnderCeiling('Atlas entries by tier:', records, { separator: '\n', omittedHint: (n) => `[${n} more tiers left out; narrow with \`owner\`.]` })
        : 'The Atlas holds no entries in reach.',
      data: { entries: tiers.reduce((n, t) => n + t.entries.length, 0) },
    }
  }

  const needle = foldAtlasTerm(q.name)
  const hits: Array<{ loc: AtlasLocation; entry: AtlasRecord }> = []
  for (const { loc, entries } of tiers) {
    for (const entry of entries) {
      if (atlasTermsOf(entry).some((t) => foldAtlasTerm(t) === needle)) hits.push({ loc, entry })
    }
  }
  logger.debug('lookup_atlas: by name', { name: q.name, hits: hits.length })
  if (hits.length === 0) {
    const nearest = nearestByName(q.name, tiers.flatMap(({ entries }) => entries.flatMap((e) => atlasTermsOf(e))), 3)
    return {
      ok: true,
      text: `No Atlas entry is called "${q.name}".${nearest.length ? ` Nearest: ${nearest.map((n) => `"${n}"`).join(', ')}.` : ''} Try find_documents for the name in other files.`,
      data: { entries: 0 },
    }
  }
  const records = hits.map(({ loc, entry }) =>
    [
      `## ${entry.name} (${tierLabel(loc)})`,
      entry.aliases?.length ? `Aliases: ${entry.aliases.join(', ')}` : 'Aliases: (none)',
      `Graphic prompt: ${entry.graphicPrompt?.trim() || '(none)'}`,
      entry.knowledge?.trim() || '(no knowledge recorded)',
    ].join('\n'),
  )
  return {
    ok: true,
    text: joinUnderCeiling(`${hits.length} Atlas entr${hits.length === 1 ? 'y' : 'ies'} named "${q.name}":`, records, {
      omittedHint: (n) => `[${n} more entries left out for length; narrow with \`owner\`.]`,
    }),
    data: { entries: hits.length },
  }
}
