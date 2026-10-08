/**
 * Consolidation task: schema + membership validation (memory-consolidation-and-tiers.md §C4).
 */

import {
  buildConsolidationUserMessage,
  consolidateMemoryCluster,
  parseConsolidationResponse,
  validateConsolidationOutput,
  CONSOLIDATION_SYSTEM_PROMPT,
  type ConsolidationCallInput,
} from '../consolidation-tasks'

jest.mock('../core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}))

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

import { executeCheapLLMTask } from '../core-execution'

const mockExecute = executeCheapLLMTask as jest.MockedFunction<typeof executeCheapLLMTask>

const digest = (memberIds: string[], extra: Record<string, unknown> = {}) => ({
  content: 'Charlie prefers tea now; preferred coffee until late August.',
  summary: 'prefers tea over coffee',
  keywords: ['tea', 'coffee', 'present', 'scope: wide', 'trivia'],
  importance: 0.6,
  kind: 'semantic',
  memberIds,
  ...extra,
})

describe('validateConsolidationOutput', () => {
  const handles = ['m1', 'm2', 'm3', 'm4']

  it('accepts a well-formed answer and folds unlisted members into keepStandalone', () => {
    const result = validateConsolidationOutput(
      { digests: [digest(['m1', 'm2'])], keepStandalone: ['m3'], contradictions: [] },
      handles,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.digests).toHaveLength(1)
    expect(result.value.keepStandalone).toEqual(['m3', 'm4'])
    expect(result.value.unlisted).toEqual(['m4'])
  })

  it('defaults missing keepStandalone / contradictions arrays', () => {
    const result = validateConsolidationOutput({ digests: [digest(['m1', 'm2', 'm3', 'm4'])] }, handles)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.keepStandalone).toEqual([])
    expect(result.value.contradictions).toEqual([])
  })

  it('treats a total absence of digests as everything standalone', () => {
    const result = validateConsolidationOutput({ digests: [] }, handles)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.keepStandalone).toEqual(handles)
  })

  it('fails when a digest names a member that was not an input', () => {
    const result = validateConsolidationOutput({ digests: [digest(['m1', 'm9'])] }, handles)
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('unknown member "m9"') })
  })

  it('fails when a member is listed in two digests', () => {
    const result = validateConsolidationOutput(
      { digests: [digest(['m1', 'm2']), digest(['m2', 'm3'])] },
      handles,
    )
    expect(result.ok).toBe(false)
  })

  it('fails when a member is both digested and kept standalone', () => {
    const result = validateConsolidationOutput(
      { digests: [digest(['m1', 'm2'])], keepStandalone: ['m2'] },
      handles,
    )
    expect(result.ok).toBe(false)
  })

  it('fails on a schema violation (missing content, empty memberIds, importance out of range)', () => {
    expect(validateConsolidationOutput({ digests: [{ ...digest(['m1']), content: '' }] }, handles).ok).toBe(false)
    expect(validateConsolidationOutput({ digests: [digest([])] }, handles).ok).toBe(false)
    expect(validateConsolidationOutput({ digests: [digest(['m1'], { importance: 1.4 })] }, handles).ok).toBe(false)
    expect(validateConsolidationOutput({ digests: 'nope' }, handles).ok).toBe(false)
    expect(validateConsolidationOutput(null, handles).ok).toBe(false)
  })

  it('drops contradictions that name unknown handles', () => {
    const result = validateConsolidationOutput(
      {
        digests: [digest(['m1', 'm2'])],
        contradictions: [
          { olderId: 'm1', newerId: 'm2', note: 'changed' },
          { olderId: 'm1', newerId: 'm8', note: 'bogus' },
        ],
      },
      handles,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.contradictions).toEqual([{ olderId: 'm1', newerId: 'm2', note: 'changed' }])
  })
})

describe('parseConsolidationResponse', () => {
  it('parses an answer wrapped in a code fence and prose', () => {
    const text = 'Here you are:\n```json\n' + JSON.stringify({ digests: [digest(['m1', 'm2'])] }) + '\n```'
    const result = parseConsolidationResponse(text, ['m1', 'm2'])
    expect(result.ok).toBe(true)
  })

  it('reports unparseable output as a failed validation instead of throwing', () => {
    const result = parseConsolidationResponse('I would rather not.', ['m1'])
    expect(result.ok).toBe(false)
  })
})

describe('buildConsolidationUserMessage', () => {
  const base: ConsolidationCallInput = {
    holderName: 'Friday',
    subjectName: 'Laura',
    bucket: 'other',
    clusterKind: 'semantic',
    canonBlock: 'ALREADY ESTABLISHED about Laura\n[IDENTITY] A cartographer.',
    existingDigest: null,
    members: [
      { handle: 'm1', when: '2026-08-01T10:00:00.000Z', importance: 0.6, reinforcementCount: 1, content: 'Laura likes maps.' },
      { handle: 'm2', when: null, importance: 0.8, reinforcementCount: 3, content: 'Laura drew\na new chart.' },
    ],
  }

  it('renders holder, subject, third-person voice, canon, and one line per member', () => {
    const msg = buildConsolidationUserMessage(base)
    expect(msg).toContain('HOLDER: Friday')
    expect(msg).toContain('SUBJECT: Laura')
    expect(msg).toContain('VOICE: third person')
    expect(msg).toContain('[IDENTITY] A cartographer.')
    expect(msg).toContain('m1 | 2026-08-01 | 0.60 | 1 | Laura likes maps.')
    expect(msg).toContain('m2 | undated | 0.80 | 3 | Laura drew a new chart.')
  })

  it('asks for first person in the self bucket and shows an existing digest', () => {
    const msg = buildConsolidationUserMessage({ ...base, bucket: 'self', existingDigest: 'I keep the Estate.' })
    expect(msg).toContain('VOICE: first person')
    expect(msg).toContain('EXISTING DIGEST\nI keep the Estate.')
  })

  it('marks episode clusters', () => {
    expect(buildConsolidationUserMessage({ ...base, clusterKind: 'episodic' })).toContain('CLUSTER: EPISODE')
  })
})

describe('consolidateMemoryCluster', () => {
  it('sends the stable system prompt and validates with the member handles', async () => {
    mockExecute.mockImplementation(async (_sel, messages, _user, parse) => ({
      success: true,
      result: parse(JSON.stringify({ digests: [digest(['m1', 'm2'])] })),
    }))
    const result = await consolidateMemoryCluster(
      {
        holderName: 'Friday',
        subjectName: 'Laura',
        bucket: 'other',
        clusterKind: 'semantic',
        canonBlock: null,
        existingDigest: null,
        members: [
          { handle: 'm1', when: null, importance: 0.5, reinforcementCount: 1, content: 'a' },
          { handle: 'm2', when: null, importance: 0.5, reinforcementCount: 1, content: 'b' },
        ],
      },
      { provider: 'OPENAI', modelName: 'x', isLocal: false } as any,
      'user-1',
    )
    const messages = mockExecute.mock.calls[0][1]
    expect(messages[0]).toEqual({ role: 'system', content: CONSOLIDATION_SYSTEM_PROMPT })
    expect(mockExecute.mock.calls[0][4]).toBe('memory-consolidation')
    expect(result.result?.ok).toBe(true)
  })
})
