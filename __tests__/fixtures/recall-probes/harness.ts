/**
 * The recall probe fixture's world: one character's corpus, an embedding table
 * keyed by text, and in-memory stand-ins for the memory index and the
 * repository reads recall makes. Shared by the fixture test so the ranking it
 * pins runs against exactly the corpus the fixture was captured on.
 *
 * See `README.md` beside this file for what the fixture is and is not.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface ProbeMemory {
  id: string
  characterId: string
  content: string
  summary: string
  keywords: string[]
  tags: string[]
  importance: number
  reinforcedImportance: number
  reinforcementCount: number
  aboutCharacterId: string | null
  chatId: string | null
  projectId: string | null
  source: 'AUTO' | 'MANUAL' | 'CONSOLIDATED'
  tier: 'hot' | 'cold'
  kind: 'semantic' | 'episodic'
  relatedMemoryIds: string[]
  occurredAt: string | null
  narrativeTime: string | null
  lastAccessedAt: string | null
  lastReinforcedAt: string | null
  createdAt: string
  updatedAt: string
  embedding: number[]
}

export interface ProbeRecallContext {
  currentProjectId: string | null
  scopePolicy: 'down-weight' | 'exclude'
  presentAboutCharacterIds: string[]
  presentParticipantNames: string[]
  turnContext: string | null
  turnTemporal: string | null
  turnRetrospective: boolean
  expandRelated: boolean
  recentlyWhisperedIds: string[]
  currentChatId: string
  nowMs: number
}

export interface ProbeExpectedRow {
  id: string
  score: number
  salience: number
  blendedAfter: number | null
  fired: string[]
  usedEmbedding: boolean
}

export interface ProbeTurn {
  slot: string
  query: string
  limit: number
  headSize: number
  minImportance: number
  entityAnchors: string[]
  occurredWithin: { from: string; to: string } | null
  extraProbes: string[]
  weightClockMs: number
  recallContext: ProbeRecallContext
  gold: string[]
  expected: ProbeExpectedRow[]
}

export interface ProbeFixture {
  description: string
  characterId: string
  memories: ProbeMemory[]
  /** Text → vector. A query or probe absent here fails to embed. */
  embeddings: Record<string, number[]>
  turns: ProbeTurn[]
  /** Σ gold memories in the head (top `headSize`) over every turn. */
  goldAtHead: number
  goldTotal: number
}

export const FIXTURE_PATH = path.join(__dirname, 'probe-set.json')

export function loadProbeFixture(): ProbeFixture {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as ProbeFixture
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

/** The corpus as Memory-shaped rows (embeddings as Float32Array). */
export function probeRows(fixture: ProbeFixture) {
  return fixture.memories.map(m => ({ ...m, embedding: new Float32Array(m.embedding) }))
}

/**
 * Implementations for the three seams recall reads through. Wire them into
 * `jest.mock` factories in the test file.
 */
export function probeWorld(fixture: ProbeFixture) {
  const rows = probeRows(fixture)
  const byId = new Map(rows.map(r => [r.id, r]))

  const embed = async (text: string) => {
    const vector = fixture.embeddings[text]
    if (!vector) throw new Error(`probe fixture has no embedding for "${text.slice(0, 60)}"`)
    return { embedding: new Float32Array(vector), provider: 'OPENAI', model: 'probe', dimensions: vector.length }
  }

  const index = {
    search: async (
      _characterId: string,
      vector: Float32Array,
      opts: { limit: number; hotOnly: boolean; exclude?: ReadonlySet<string> },
    ) => {
      return rows
        .filter(r => r.embedding.length === vector.length)
        .filter(r => !opts.hotOnly || r.tier !== 'cold')
        .filter(r => !opts.exclude || !opts.exclude.has(r.id))
        .map(r => ({ id: r.id, score: cosine(vector, r.embedding), metadata: { memoryId: r.id, characterId: r.characterId, tier: r.tier } }))
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.limit)
    },
    shape: async (_characterId: string, queryDimensions: number) => ({
      size: rows.length,
      dominantDimensions: rows.length > 0 ? rows[0].embedding.length : null,
      matching: rows.filter(r => r.embedding.length === queryDimensions).length,
    }),
  }

  const memories = {
    findByIds: async (ids: string[]) => ids.map(id => byId.get(id)).filter(Boolean),
    searchByContent: async (_characterId: string, phrase: string) => {
      const needle = phrase.toLowerCase()
      return rows.filter(r => r.content.toLowerCase().includes(needle) || r.summary.toLowerCase().includes(needle))
    },
  }

  return { rows, embed, index, memories, cosine }
}
