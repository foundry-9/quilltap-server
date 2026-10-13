/**
 * Stage 7 — render: the section text a model reads.
 *
 * A model sees each memory's age, whose life it describes (the subject
 * prefix), its words, a digest's provenance count and its human keywords —
 * nothing else. The id tags, the importance / relevance / weight numbers, the
 * multiplier labels and the raw targeting tags (`scope: narrow`, `past`, …)
 * are debug data: they go to `debugMemories` and the replay trace, never into
 * the text (decision 5; invariant 3 of the refactor spec).
 *
 * Every renderer returns the lines it wrote with the memory each carries, so
 * `deliver` can tell which rows actually reached the model.
 *
 * @module memory/recall/render
 */

import type { Provider, Memory } from '@/lib/schemas/types'
import { estimateTokens } from '@/lib/tokens/token-counter'
import { formatMemoryAge } from '../time'
import { salience } from '../scoring'
import { CONTEXT_VALUES, SCOPE_VALUES, TEMPORAL_VALUES } from './tags'
import type { RecallCandidate, RenderedLine } from './types'

/** Debug info for one rendered memory — never shown to a model. */
export interface DebugMemoryInfo {
  /** The memory's id — lets callers track which entries were delivered. */
  memoryId?: string
  summary: string
  importance: number
  score: number
  /** Salience (reinforcedImportance × time decay, no floor) — the worth term the blend uses. */
  salience: number
  /** Combined recall-context multiplier, when a recall context drove the ranking. */
  recallMultiplier?: number
  /** Labels for the adjustments that fired (e.g. `narrow✓`, `past↓`). */
  recallFired?: string[]
  /** Ranking blend before the recall multiplier. */
  blendedBefore?: number
  /** Blended score after the recall multiplier (what the head ranks on). */
  blendedAfter?: number
}

/** Debug info for one rendered inter-character memory. */
export interface DebugInterCharacterMemoryInfo {
  memoryId?: string
  aboutCharacterName: string
  summary: string
  importance: number
}

/** A rendered section: its text, its tokens, and what it carries. */
export interface RenderedSection<D = DebugMemoryInfo> {
  content: string
  tokenCount: number
  memoriesUsed: number
  lines: RenderedLine[]
  debugMemories: D[]
}

function emptySection<D>(): RenderedSection<D> {
  return { content: '', tokenCount: 0, memoriesUsed: 0, lines: [], debugMemories: [] }
}

/**
 * Whose life a memory line describes, for the self-facing blocks.
 *
 * A character's store holds what they remember about themselves and about
 * everyone else side by side; `aboutCharacterId` alone tells them apart. Every
 * self-facing block arrives under a second-person heading, so a line about
 * someone else, printed bare, reads as autobiography (bug 122). Both fields are
 * required so a new call site has to decide whose store it is printing.
 */
export interface MemorySubjectContext {
  /** The character whose store this is. Their own memories go unprefixed. */
  selfCharacterId: string
  /** `aboutCharacterId` → display name. Ids absent from the map still get a prefix. */
  characterNames: ReadonlyMap<string, string>
}

/**
 * The subject prefix for one self-facing line: `''` for the character's own
 * and untargeted memories, `About <Name>: ` otherwise, falling back to
 * `About another character: ` when the id resolves to no name.
 */
export function formatMemorySubjectPrefix(
  aboutCharacterId: string | null | undefined,
  subject: MemorySubjectContext,
): string {
  if (!aboutCharacterId) return ''
  if (aboutCharacterId === subject.selfCharacterId) return ''
  const name = subject.characterNames.get(aboutCharacterId)?.trim()
  return name ? `About ${name}: ` : 'About another character: '
}

/** Provenance suffix for a consolidated digest: ` (from 14 notes)`. Static per row. */
export function formatDigestProvenance(memory: Pick<Memory, 'source' | 'consolidatedFrom'>): string {
  if (memory.source !== 'CONSOLIDATED') return ''
  const count = memory.consolidatedFrom?.length ?? 0
  if (count <= 0) return ''
  return ` (from ${count} ${count === 1 ? 'note' : 'notes'})`
}

/** Is this keyword one of the targeting tags (`past`, `scope: narrow`, `history`, …)? */
export function isTargetingKeyword(keyword: string): boolean {
  const kw = keyword.trim().toLowerCase()
  if (kw.startsWith('scope:')) return SCOPE_VALUES.has(kw.slice('scope:'.length).trim())
  return TEMPORAL_VALUES.has(kw) || CONTEXT_VALUES.has(kw)
}

/** A row's keywords as a reader would want them: the targeting tags removed. */
export function humanKeywords(keywords: readonly string[] | null | undefined): string[] {
  return (keywords ?? [])
    .map(k => (typeof k === 'string' ? k.trim() : ''))
    .filter(k => k.length > 0 && !isTargetingKeyword(k))
}

/** The trailing keywords tag: ` _(keywords: a, b)_`, or `''` when there are none. */
export function formatKeywordsTag(keywords: readonly string[] | null | undefined): string {
  const words = humanKeywords(keywords)
  return words.length > 0 ? ` _(keywords: ${words.join(', ')})_` : ''
}

function ageTag(memory: Memory, now: Date): string {
  const age = formatMemoryAge(memory, now)
  const narrative = memory.narrativeTime?.trim()
  return narrative ? `[${age} · ${narrative}]` : `[${age}]`
}

/**
 * The frozen archive — `## Memory Anchors`. Byte-stable within a compaction
 * generation: input order verbatim (the archive arrives id-sorted), summaries
 * only, and nothing that moves with the clock or the query.
 */
export function renderArchive(
  memories: readonly Memory[],
  maxTokens: number,
  provider: Provider | undefined,
  subject: MemorySubjectContext,
): RenderedSection {
  if (memories.length === 0) return emptySection()
  const header = '## Memory Anchors'
  const parts: string[] = [header]
  let tokens = estimateTokens(`${header}\n`, provider)
  const section = emptySection<DebugMemoryInfo>()
  for (const memory of memories) {
    const body = memory.summary?.trim() || memory.content?.trim() || ''
    if (!body) continue
    const prefix = formatMemorySubjectPrefix(memory.aboutCharacterId, subject)
    const line = `- ${prefix}${body}${formatDigestProvenance(memory)}${formatKeywordsTag(memory.keywords)}`
    const lineTokens = estimateTokens(`${line}\n`, provider)
    if (tokens + lineTokens > maxTokens) break
    parts.push(line)
    tokens += lineTokens
    section.lines.push({ memoryId: memory.id, line, body })
    section.debugMemories.push({ memoryId: memory.id, summary: memory.summary, importance: memory.importance, score: 0, salience: 0 })
  }
  if (section.lines.length === 0) return emptySection()
  return { ...section, content: parts.join('\n'), tokenCount: tokens, memoriesUsed: section.lines.length }
}

/**
 * The per-turn head — `Most relevant memories for this turn:`. Ranked by the
 * post-adjustment blend when a recall context drove the search, else by
 * salience with relevance breaking near-ties; capped by entries and tokens.
 * Every line is dated: the age label, and any narrative time.
 */
export function renderHead(
  candidates: readonly RecallCandidate[],
  provider: Provider | undefined,
  subject: MemorySubjectContext,
  options: { maxTokens: number; maxEntries: number },
): RenderedSection {
  if (candidates.length === 0) return emptySection()
  const ranked = [...candidates]
    .sort((a, b) => {
      const aAdj = a.recallAdjustment?.blendedAfter
      const bAdj = b.recallAdjustment?.blendedAfter
      if (aAdj !== undefined && bAdj !== undefined) return bAdj - aAdj
      const weightDiff = b.salience - a.salience
      if (Math.abs(weightDiff) > 0.05) return weightDiff
      return b.score - a.score
    })
    .slice(0, options.maxEntries)

  const header = 'Most relevant memories for this turn:'
  const entries: string[] = []
  let tokens = estimateTokens(`${header}\n`, provider)
  const section = emptySection<DebugMemoryInfo>()
  const now = new Date()
  for (const { memory, score, salience, recallAdjustment } of ranked) {
    const body = memory.summary?.trim() || memory.content?.trim() || ''
    if (!body) continue
    const prefix = formatMemorySubjectPrefix(memory.aboutCharacterId, subject)
    const line = `${ageTag(memory, now)} ${prefix}${body}${formatDigestProvenance(memory)}${formatKeywordsTag(memory.keywords)}`
    const lineTokens = estimateTokens(`${line}\n`, provider)
    if (tokens + lineTokens > options.maxTokens) break
    entries.push(line)
    tokens += lineTokens
    section.lines.push({ memoryId: memory.id, line, body })
    section.debugMemories.push({
      memoryId: memory.id,
      summary: memory.summary,
      importance: memory.importance,
      score,
      salience,
      recallMultiplier: recallAdjustment?.multiplier,
      recallFired: recallAdjustment?.fired,
      blendedBefore: recallAdjustment?.blendedBefore,
      blendedAfter: recallAdjustment?.blendedAfter,
    })
  }
  if (section.lines.length === 0) return emptySection()
  return { ...section, content: `${header}\n${entries.join('\n')}`, tokenCount: tokens, memoriesUsed: section.lines.length }
}

/**
 * `## Relevant Memories` — full content, salience first, for a one-off call
 * that recalls against a question (Carina).
 */
export function renderRelevant(
  candidates: readonly RecallCandidate[],
  maxTokens: number,
  provider: Provider | undefined,
  subject: MemorySubjectContext,
): RenderedSection {
  if (candidates.length === 0) return emptySection()
  const header = '## Relevant Memories'
  const parts: string[] = [header]
  let tokens = estimateTokens(`${header}\n`, provider)
  const section = emptySection<DebugMemoryInfo>()
  const sorted = [...candidates].sort((a, b) => {
    const weightDiff = b.salience - a.salience
    if (Math.abs(weightDiff) > 0.05) return weightDiff
    return b.score - a.score
  })
  const now = new Date()
  for (const { memory, score, salience } of sorted) {
    const body = memory.content?.trim() || memory.summary
    const prefix = formatMemorySubjectPrefix(memory.aboutCharacterId, subject)
    const line = `- ${ageTag(memory, now)} ${prefix}${body}${formatKeywordsTag(memory.keywords)}`
    const lineTokens = estimateTokens(`${line}\n`, provider)
    if (tokens + lineTokens > maxTokens) break
    parts.push(line)
    tokens += lineTokens
    section.lines.push({ memoryId: memory.id, line, body })
    section.debugMemories.push({ memoryId: memory.id, summary: memory.summary, importance: memory.importance, score, salience })
  }
  if (section.lines.length === 0) return emptySection()
  return { ...section, content: parts.join('\n'), tokenCount: tokens, memoriesUsed: section.lines.length }
}

/**
 * `## Memories About Other Characters` — per other character, the relevance
 * half (rows about them from the turn's pool, by relevance) interleaved with
 * the importance half (digests first, then salience), deduped by id and
 * trimmed to `maxTokens`.
 */
export function renderInterCharacter(
  importanceMemories: readonly Memory[],
  characterNames: ReadonlyMap<string, string>,
  maxTokens: number,
  provider: Provider | undefined,
  relevance: readonly RecallCandidate[] = [],
  nowMs: number = Date.now(),
): RenderedSection<DebugInterCharacterMemoryInfo> {
  if (importanceMemories.length === 0 && relevance.length === 0) return emptySection()
  const header = '## Memories About Other Characters'
  const parts: string[] = [header]
  let tokens = estimateTokens(`${header}\n`, provider)
  const section = emptySection<DebugInterCharacterMemoryInfo>()

  const relevanceBy = new Map<string, RecallCandidate[]>()
  for (const r of relevance) {
    const id = r.memory.aboutCharacterId
    if (!id) continue
    relevanceBy.set(id, [...(relevanceBy.get(id) ?? []), r])
  }
  const importanceBy = new Map<string, Memory[]>()
  for (const m of importanceMemories) {
    if (!m.aboutCharacterId) continue
    importanceBy.set(m.aboutCharacterId, [...(importanceBy.get(m.aboutCharacterId) ?? []), m])
  }
  const characterIds = new Set<string>([...relevanceBy.keys(), ...importanceBy.keys()])
  const now = new Date(nowMs)

  for (const characterId of characterIds) {
    const name = characterNames.get(characterId) || 'Unknown'
    const rel = [...(relevanceBy.get(characterId) ?? [])].sort((a, b) => b.score - a.score).map(r => r.memory)
    const relIds = new Set(rel.map(m => m.id))
    const imp = (importanceBy.get(characterId) ?? [])
      .filter(m => !relIds.has(m.id))
      .map(m => ({ m, w: salience(m, { nowMs }).salience }))
      .sort((a, b) => {
        const da = a.m.source === 'CONSOLIDATED' ? 1 : 0
        const db = b.m.source === 'CONSOLIDATED' ? 1 : 0
        return db - da || b.w - a.w
      })
      .map(x => x.m)
    const ordered: Memory[] = []
    for (let i = 0; i < Math.max(rel.length, imp.length); i++) {
      if (i < rel.length) ordered.push(rel[i])
      if (i < imp.length) ordered.push(imp[i])
    }
    for (const memory of ordered) {
      const body = memory.content?.trim() || memory.summary
      const line = `- About ${name}: [${formatMemoryAge(memory, now)}] ${body}${formatDigestProvenance(memory)}${formatKeywordsTag(memory.keywords)}`
      const lineTokens = estimateTokens(`${line}\n`, provider)
      if (tokens + lineTokens > maxTokens) break
      parts.push(line)
      tokens += lineTokens
      section.lines.push({ memoryId: memory.id, line, body })
      section.debugMemories.push({ memoryId: memory.id, aboutCharacterName: name, summary: memory.summary, importance: memory.importance })
    }
  }
  if (section.lines.length === 0) return emptySection()
  return { ...section, content: parts.join('\n'), tokenCount: tokens, memoriesUsed: section.lines.length }
}
