/**
 * The recall renderers (`lib/memory/recall/render.ts`).
 *
 * - The frozen archive emits memories in the order it received them (the
 *   caller id-sorts), so its text is byte-stable across turns.
 * - The head respects its token and entry budgets and uses the summary.
 * - No model sees a debug label (invariant 3 of the refactor spec): no id tag,
 *   no importance / relevance / weight number, no multiplier label and no raw
 *   targeting tag — only age, subject, words, provenance and human keywords.
 */

import {
  renderArchive,
  renderHead,
  renderRelevant,
  renderInterCharacter,
  renderInnerCircle,
  formatMemorySubjectPrefix,
  formatKeywordsTag,
  humanKeywords,
  isTargetingKeyword,
} from '@/lib/memory/recall/render'
import { DYNAMIC_HEAD_TOKEN_BUDGET, DYNAMIC_HEAD_DEFAULT_SIZE } from '@/lib/memory/recall/assemble'
import type { InnerCircleEntry, RecallCandidate } from '@/lib/memory/recall/types'
import type { Memory, Provider } from '@/lib/schemas/types'

const provider: Provider = {
  id: '00000000-0000-0000-0000-0000000000aa',
  name: 'test',
  type: 'OPENAI',
  baseUrl: 'http://localhost',
  apiKeyId: '00000000-0000-0000-0000-0000000000bb',
  models: ['test-model'],
  defaultModel: 'test-model',
  isEnabled: true,
  isCustom: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
} as unknown as Provider

function memory(
  id: string,
  summary: string,
  content: string = summary,
  overrides: Partial<Memory> = {},
): Memory {
  return {
    id,
    characterId: '00000000-0000-0000-0000-0000000000c1',
    content,
    summary,
    keywords: [],
    tags: [],
    importance: 0.7,
    source: 'AUTO',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: 0.7,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Memory
}

function searchResult(m: Memory, score: number = 0.8, weight: number = 0.7): RecallCandidate {
  return { memory: m, score, usedEmbedding: true, salience: weight }
}

/** The owning character in these fixtures — `memory()` stamps this as `characterId`. */
const SELF_ID = '00000000-0000-0000-0000-0000000000c1'

/**
 * Default subject context: the memories under test are the character's own, so
 * every self-facing line renders unprefixed.
 */
const SELF_SUBJECT = { selfCharacterId: SELF_ID, characterNames: new Map<string, string>() }


/** The head with its historical defaults. */
function head(
  results: RecallCandidate[],
  p: Provider,
  subject: typeof SELF_SUBJECT,
  opts: { maxTokens?: number; maxEntries?: number } = {},
) {
  return renderHead(results, p, subject, {
    maxTokens: opts.maxTokens ?? DYNAMIC_HEAD_TOKEN_BUDGET,
    maxEntries: opts.maxEntries ?? DYNAMIC_HEAD_DEFAULT_SIZE,
  })
}

const EMPTY = { content: '', tokenCount: 0, memoriesUsed: 0, lines: [], debugMemories: [] }

describe('renderArchive', () => {
  it('emits memories in input order (caller sorts by id)', () => {
    const archive = [
      memory('a-id', 'first archive entry'),
      memory('b-id', 'second archive entry'),
      memory('c-id', 'third archive entry'),
    ]

    const result = renderArchive(archive, 1000, provider, SELF_SUBJECT)

    expect(result.memoriesUsed).toBe(3)
    expect(result.content).toContain('## Memory Anchors')
    const positions = ['first archive entry', 'second archive entry', 'third archive entry']
      .map(s => result.content.indexOf(s))
    expect(positions[0]).toBeGreaterThan(0)
    expect(positions[1]).toBeGreaterThan(positions[0])
    expect(positions[2]).toBeGreaterThan(positions[1])
  })

  it('is byte-identical across consecutive calls', () => {
    const archive = [
      memory('a', 'alpha'),
      memory('b', 'bravo'),
      memory('c', 'charlie'),
    ]
    const a = renderArchive(archive, 1000, provider, SELF_SUBJECT)
    const b = renderArchive(archive, 1000, provider, SELF_SUBJECT)
    expect(b.content).toBe(a.content)
  })

  it('returns empty content when memories array is empty', () => {
    const result = renderArchive([], 1000, provider, SELF_SUBJECT)
    expect(result).toEqual(EMPTY)
  })

  it('truncates at the token budget', () => {
    const archive = Array.from({ length: 30 }, (_, i) =>
      memory(`m-${i.toString().padStart(2, '0')}`, `summary item number ${i}`),
    )
    const result = renderArchive(archive, 50, provider, SELF_SUBJECT)
    expect(result.memoriesUsed).toBeLessThan(30)
    expect(result.tokenCount).toBeLessThanOrEqual(50)
  })

  it('uses summary, not full content', () => {
    const archive = [memory('a', 'short summary', 'a much longer body that should not appear')]
    const result = renderArchive(archive, 1000, provider, SELF_SUBJECT)
    expect(result.content).toContain('short summary')
    expect(result.content).not.toContain('a much longer body')
  })
})

describe('renderInnerCircle', () => {
  const ABIGAIL = '00000000-0000-0000-0000-0000000000a1'
  const GREG = '00000000-0000-0000-0000-0000000000a2'
  const subject = { selfCharacterId: SELF_ID, characterNames: new Map([[ABIGAIL, 'Abigail'], [GREG, 'Greg']]) }
  function entry(id: string, about: string, tier: number, rank: number, order: number, content: string): InnerCircleEntry {
    return {
      memory: memory(id, `${id} summary`, content, { aboutCharacterId: about, keywords: ['family', 'past'] }),
      characterId: about,
      tier,
      rank,
      order,
    }
  }
  const entries = [
    entry('a-0', ABIGAIL, 0, 0, 0, 'Abigail has green hair and is carrying Charlie\'s daughter'),
    entry('a-1', ABIGAIL, 0, 1, 0, 'Abigail captains the Revenant'),
    entry('g-0', GREG, 2, 0, 1, 'Greg keeps the club accounts'),
  ]

  it('renders full text under its own heading, in circle order, with subjects and no age tag', () => {
    const result = renderInnerCircle(entries, 1000, provider, subject)
    expect(result.content).toBe([
      '## Those Closest to You',
      '- About Abigail: Abigail has green hair and is carrying Charlie\'s daughter _(keywords: family)_',
      '- About Abigail: Abigail captains the Revenant _(keywords: family)_',
      '- About Greg: Greg keeps the club accounts _(keywords: family)_',
    ].join('\n'))
    expect(result.content).not.toContain('summary')
    expect(result.lines.map(l => l.memoryId)).toEqual(['a-0', 'a-1', 'g-0'])
  })

  it('cuts the loosest tier first when the budget binds, keeping circle order for the rest', () => {
    const full = renderInnerCircle(entries, 1000, provider, subject)
    const greg = full.lines.find(l => l.memoryId === 'g-0')!
    const tight = renderInnerCircle(entries, full.tokenCount - 1, provider, subject)
    expect(tight.lines.map(l => l.memoryId)).toEqual(['a-0', 'a-1'])
    expect(tight.content).not.toContain(greg.line)
  })

  it('cuts a member\'s later digests before a looser tier\'s first only within the same tier', () => {
    const sameTier = [
      entry('a-0', ABIGAIL, 0, 0, 0, 'first about Abigail'),
      entry('a-1', ABIGAIL, 0, 1, 0, 'second about Abigail'),
      entry('g-0', GREG, 0, 0, 1, 'first about Greg'),
    ]
    const full = renderInnerCircle(sameTier, 1000, provider, subject)
    const tight = renderInnerCircle(sameTier, full.tokenCount - 1, provider, subject)
    expect(tight.lines.map(l => l.memoryId)).toEqual(['a-0', 'g-0'])
  })

  it('is empty with no entries or no room', () => {
    expect(renderInnerCircle([], 1000, provider, subject)).toEqual(EMPTY)
    expect(renderInnerCircle(entries, 1, provider, subject)).toEqual(EMPTY)
  })
})

describe('renderHead', () => {
  it('emits the head under its heading, dated, with no id tags', () => {
    const results = [
      searchResult(memory('11111111-aaaa-bbbb-cccc-000000000001', 'first relevant'), 0.95, 0.85),
      searchResult(memory('22222222-aaaa-bbbb-cccc-000000000002', 'second relevant'), 0.9, 0.8),
    ]
    const r = head(results, provider, SELF_SUBJECT)
    expect(r.content).toContain('Most relevant memories for this turn:')
    expect(r.content).not.toMatch(/\[m_/)
    expect(r.content).toMatch(/^\[[^\]]+\] first relevant$/m)
    expect(r.memoriesUsed).toBe(2)
    expect(r.lines.map(l => l.memoryId)).toEqual([
      '11111111-aaaa-bbbb-cccc-000000000001',
      '22222222-aaaa-bbbb-cccc-000000000002',
    ])
  })

  it('respects DYNAMIC_HEAD_TOKEN_BUDGET by default', () => {
    const longSummary = 'a long summary that uses many tokens '.repeat(20)
    const results = Array.from({ length: 10 }, (_, i) =>
      searchResult(memory(`abcdef${i}-0000-0000-0000-000000000000`, longSummary)),
    )
    const r = head(results, provider, SELF_SUBJECT)
    expect(r.tokenCount).toBeLessThanOrEqual(DYNAMIC_HEAD_TOKEN_BUDGET)
  })

  it('caps entries at DYNAMIC_HEAD_DEFAULT_SIZE by default', () => {
    expect(DYNAMIC_HEAD_DEFAULT_SIZE).toBeGreaterThan(0)
    const results = Array.from({ length: DYNAMIC_HEAD_DEFAULT_SIZE + 5 }, (_, i) =>
      searchResult(memory(`a${i}-0000-0000-0000-000000000000`, `entry ${i}`)),
    )
    const r = head(results, provider, SELF_SUBJECT)
    expect(r.memoriesUsed).toBeLessThanOrEqual(DYNAMIC_HEAD_DEFAULT_SIZE)
  })

  it('returns empty content when results is empty', () => {
    const r = head([], provider, SELF_SUBJECT)
    expect(r).toEqual(EMPTY)
  })

  it('orders by effective weight then score', () => {
    const lowWeight = searchResult(memory('a-aaaa-1111-1111-111111111111', 'low'), 0.99, 0.3)
    const highWeight = searchResult(memory('b-bbbb-2222-2222-222222222222', 'high'), 0.5, 0.9)
    const r = head([lowWeight, highWeight], provider, SELF_SUBJECT, { maxEntries: 2 })
    const highIdx = r.content.indexOf('high')
    const lowIdx = r.content.indexOf('low')
    expect(highIdx).toBeGreaterThan(0)
    expect(lowIdx).toBeGreaterThan(0)
    expect(highIdx).toBeLessThan(lowIdx)
  })

  it('uses summary, not full content', () => {
    const m = memory('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'short summary', 'long body content')
    const r = head([searchResult(m)], provider, SELF_SUBJECT)
    expect(r.content).toContain('short summary')
    expect(r.content).not.toContain('long body content')
  })
})

describe('render: archive byte-stability with keywords', () => {
  it('is byte-identical across calls once keywords render', () => {
    const archive = [
      memory('a', 'alpha', undefined, { importance: 0.7, keywords: ['x'] }),
      memory('b', 'bravo', undefined, { importance: 0.8, keywords: ['y', 'z'] }),
    ]
    const first = renderArchive(archive, 1000, provider, SELF_SUBJECT)
    const second = renderArchive(archive, 1000, provider, SELF_SUBJECT)
    expect(second.content).toBe(first.content)
  })
})

/**
 * Bug 122 — a character's memory store holds what they remember about OTHER
 * people alongside their own, separated only by `aboutCharacterId`. All three
 * self-facing blocks are delivered under "You remember the following entries
 * that bear on this moment", so an unattributed line about someone else reads
 * as autobiography — and a weak model will answer the turn in that person's
 * voice, fluently and wrongly.
 *
 * Live failure: Kumar's archive carried "struggles to become offered mother"
 * (Marion's) and his head carried "reassured Marie about her wish" (Marion's),
 * both bare. He replied as Marion.
 */
describe('render: self-facing blocks attribute other characters (bug 122)', () => {
  const MARION_ID = '00000000-0000-0000-0000-0000000000c2'
  const subject = {
    selfCharacterId: SELF_ID,
    characterNames: new Map([[MARION_ID, 'Marion']]),
  }

  const marionMemory = (id: string, summary: string) =>
    memory(id, summary, summary, { aboutCharacterId: MARION_ID })

  it('formatMemorySubjectPrefix returns nothing for the character\'s own memories', () => {
    expect(formatMemorySubjectPrefix(SELF_ID, subject)).toBe('')
  })

  it('formatMemorySubjectPrefix returns nothing for an untargeted memory', () => {
    expect(formatMemorySubjectPrefix(null, subject)).toBe('')
    expect(formatMemorySubjectPrefix(undefined, subject)).toBe('')
  })

  it('formatMemorySubjectPrefix names another character', () => {
    expect(formatMemorySubjectPrefix(MARION_ID, subject)).toBe('About Marion: ')
  })

  it('formatMemorySubjectPrefix still prefixes an unresolvable subject', () => {
    // The name is a nicety; breaking the first-person reading is the job.
    expect(formatMemorySubjectPrefix('00000000-0000-0000-0000-00000000dead', subject)).toBe(
      'About another character: ',
    )
  })

  it('the frozen archive names the subject of a memory about someone else', () => {
    const r = renderArchive(
      [marionMemory('a-id', 'struggles to become offered mother')],
      1000,
      provider,
      subject,
    )
    expect(r.content).toContain('- About Marion: struggles to become offered mother')
  })

  it('the dynamic head names the subject of a memory about someone else', () => {
    const r = head(
      [searchResult(marionMemory('11111111-aaaa-bbbb-cccc-000000000001', 'reassured Marie about her wish'))],
      provider,
      subject,
    )
    expect(r.content).toContain('About Marion: reassured Marie about her wish')
  })

  it('renderRelevant names the subject of a memory about someone else', () => {
    const r = renderRelevant(
      [searchResult(marionMemory('1', 'breastfed Camille in the pool'))],
      1000,
      provider,
      subject,
    )
    expect(r.content).toContain('About Marion: breastfed Camille in the pool')
  })

  it('leaves the character\'s own memories unprefixed in every self-facing block', () => {
    const own = memory('own-id', 'ran the trial sheet twice', 'ran the trial sheet twice', {
      aboutCharacterId: SELF_ID,
    })
    const archive = renderArchive([own], 1000, provider, subject)
    const headSection = head([searchResult(own)], provider, subject)
    const relevant = renderRelevant([searchResult(own)], 1000, provider, subject)
    for (const content of [archive.content, headSection.content, relevant.content]) {
      expect(content).toContain('ran the trial sheet twice')
      expect(content).not.toContain('About ')
    }
  })

  it('keeps the frozen archive byte-stable once subjects are attributed', () => {
    const archive = [
      marionMemory('a-id', 'struggles to become offered mother'),
      memory('b-id', 'ran the trial sheet twice'),
    ]
    const first = renderArchive(archive, 1000, provider, subject)
    const second = renderArchive(archive, 1000, provider, subject)
    expect(first.content).toBe(second.content)
  })

  it('counts the prefix against the token budget rather than smuggling it past', () => {
    // The prefix is prose the model pays for, so it must be inside the
    // estimate: the same budget that fits N own-memory lines must fit fewer
    // attributed ones, and must still not overrun.
    const own = Array.from({ length: 12 }, (_, i) =>
      memory(`own-${i}`, `entry number ${i} in the archive`),
    )
    const others = Array.from({ length: 12 }, (_, i) =>
      marionMemory(`m-${i}`, `entry number ${i} in the archive`),
    )
    const bare = renderArchive(own, 120, provider, subject)
    const attributed = renderArchive(others, 120, provider, subject)
    expect(attributed.tokenCount).toBeLessThanOrEqual(120)
    expect(attributed.memoriesUsed).toBeLessThan(bare.memoriesUsed)
  })
})

describe('render: targeting tags and keywords', () => {
  it('recognises every targeting tag, and nothing else', () => {
    for (const tag of ['past', 'moment', 'present', 'future', 'scope: narrow', 'scope: wide', 'history', 'banter', 'information']) {
      expect(isTargetingKeyword(tag)).toBe(true)
    }
    for (const word of ['ledger', 'scope: telescope', 'trust']) {
      expect(isTargetingKeyword(word)).toBe(false)
    }
  })

  it('keeps the human keywords only', () => {
    expect(humanKeywords(['ledger', 'past', 'scope: narrow', ' trust ', '', 'relationships'])).toEqual(['ledger', 'trust'])
  })

  it('renders a keywords tag, or nothing', () => {
    expect(formatKeywordsTag(['titles', 'load-bearing', 'present'])).toBe(' _(keywords: titles, load-bearing)_')
    expect(formatKeywordsTag(['past', 'scope: wide'])).toBe('')
    expect(formatKeywordsTag(null)).toBe('')
  })
})

/** Invariant 3: the renderer output never carries a debug label. */
const DEBUG_LABEL = /recall:|\[m_|importance 0\.|relevance 0\.|weight 0\.|scope: (narrow|wide)|(^|[ ,(])(past|moment|future)(,|\)|$)/m

describe('render: no model sees a debug label (decision 5)', () => {
  const tagged = (id: string, summary: string, content = summary) =>
    memory(id, summary, content, {
      importance: 0.98,
      keywords: ['titles', 'load-bearing', 'past', 'scope: narrow', 'history'],
    })
  const adjusted = (m: Memory): RecallCandidate => ({
    memory: m,
    score: 0.87,
    usedEmbedding: true,
    salience: 0.92,
    recallAdjustment: { multiplier: 1.4, fired: ['narrow✓', 'past↓', 'cap1.4', 'gate×0.50'], blendedBefore: 0.6, blendedAfter: 0.84 },
  })

  it('the archive carries words, provenance and human keywords only', () => {
    const r = renderArchive([tagged('a-id', 'frozen anchor entry')], 1000, provider, SELF_SUBJECT)
    expect(r.content).toBe('## Memory Anchors\n- frozen anchor entry _(keywords: titles, load-bearing)_')
    expect(r.content).not.toMatch(DEBUG_LABEL)
  })

  it('the head carries the age, the words and human keywords — not the ranking', () => {
    const r = head([adjusted(tagged('11111111-aaaa-bbbb-cccc-000000000001', 'first relevant'))], provider, SELF_SUBJECT)
    expect(r.content).toMatch(/^Most relevant memories for this turn:\n\[[^\]]+\] first relevant _\(keywords: titles, load-bearing\)_$/)
    expect(r.content).not.toMatch(DEBUG_LABEL)
    // The ranking survives in the debug record.
    expect(r.debugMemories[0]).toMatchObject({ score: 0.87, salience: 0.92, recallMultiplier: 1.4, recallFired: ['narrow✓', 'past↓', 'cap1.4', 'gate×0.50'] })
  })

  it('the relevant block carries the full content, dated', () => {
    const r = renderRelevant([adjusted(tagged('1', 'short summary', 'body text'))], 1000, provider, SELF_SUBJECT)
    expect(r.content).toMatch(/^## Relevant Memories\n- \[[^\]]+\] body text _\(keywords: titles, load-bearing\)_$/)
    expect(r.content).not.toMatch(DEBUG_LABEL)
  })

  it('the inter-character block names the subject and drops the scores', () => {
    const iris = '00000000-0000-0000-0000-000000000c02'
    const imp = memory('imp-1', 'iris likes tea', 'Iris always takes tea at four', { importance: 0.9, aboutCharacterId: iris, keywords: ['tea', 'present'] })
    const rel = memory('rel-1', 'iris fears storms', 'Iris flinches at thunder', { importance: 0.6, aboutCharacterId: iris })
    const r = renderInterCharacter([imp], new Map([[iris, 'Iris']]), 2000, provider, [adjusted(rel)])
    expect(r.content).toContain('- About Iris: [')
    expect(r.content).toContain('Iris always takes tea at four _(keywords: tea)_')
    expect(r.content).toContain('Iris flinches at thunder')
    expect(r.content).not.toMatch(DEBUG_LABEL)
    expect(r.memoriesUsed).toBe(2)
    // Relevance first, then importance.
    expect(r.lines.map(l => l.memoryId)).toEqual(['rel-1', 'imp-1'])
  })

  it('the inter-character block renders a row in both halves once', () => {
    const iris = '00000000-0000-0000-0000-000000000c02'
    const shared = memory('dup-1', 'iris keeps the ledger', 'Iris guards the ledger closely', { importance: 0.8, aboutCharacterId: iris })
    const r = renderInterCharacter([shared], new Map([[iris, 'Iris']]), 2000, provider, [searchResult(shared, 0.88)])
    expect(r.memoriesUsed).toBe(1)
    expect((r.content.match(/Iris guards the ledger closely/g) || []).length).toBe(1)
  })

  it('every rendered line records the memory it carries and its words', () => {
    const r = renderArchive([tagged('a', 'alpha'), tagged('b', 'bravo')], 1000, provider, SELF_SUBJECT)
    expect(r.lines).toEqual([
      expect.objectContaining({ memoryId: 'a', body: 'alpha' }),
      expect.objectContaining({ memoryId: 'b', body: 'bravo' }),
    ])
  })
})

describe('renderHead — the clock', () => {
  it('dates entries against the clock it is given, not the wall clock', () => {
    const occurred = Date.parse('2026-06-01T12:00:00.000Z')
    const m = memory('11111111-aaaa-bbbb-cccc-000000000001', 'the fair', undefined, { occurredAt: new Date(occurred).toISOString() })
    const r = renderHead([searchResult(m)], provider, SELF_SUBJECT, { maxTokens: 200, maxEntries: 5, nowMs: occurred + 3 * 86_400_000 })
    expect(r.content).toContain('[3 days ago] the fair')
  })
})
