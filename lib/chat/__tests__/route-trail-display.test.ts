import type { RouteAttempt } from '@/lib/schemas/chat.types'
import {
  ROUTE_OUTCOME_GLYPH,
  collapseRouteTrail,
  describeRouteAttempt,
  routeOutcomeLabel,
} from '../route-trail-display'

const OPENAI = '00000000-0000-4000-8000-00000000000a'
const ANTHROPIC = '00000000-0000-4000-8000-00000000000b'
const DEEPSEEK = '00000000-0000-4000-8000-00000000000c'

function attempt(overrides: Partial<RouteAttempt> = {}): RouteAttempt {
  return {
    profileId: OPENAI,
    profileName: 'OpenAI gpt-5',
    provider: 'openai',
    modelName: 'gpt-5',
    via: 'primary',
    outcome: 'failed',
    trigger: 'network',
    detail: 'Connection error.',
    ...overrides,
  } as RouteAttempt
}

describe('collapseRouteTrail', () => {
  it('leaves a trail of distinct profiles alone, in order', () => {
    const rows = collapseRouteTrail([
      attempt(),
      attempt({ profileId: ANTHROPIC, profileName: 'Anthropic Sonnet', provider: 'anthropic', modelName: 'claude-sonnet-5', via: 'understudy', outcome: 'refused', trigger: 'moderation-refusal', evidence: 'finish-reason', detail: 'finish_reason: refusal' }),
      attempt({ profileId: DEEPSEEK, profileName: 'DeepSeek', provider: 'deepseek', modelName: 'deepseek-v4-pro', via: 'tier-pick', outcome: 'answered', trigger: undefined, detail: undefined }),
    ])

    expect(rows.map((r) => r.profileId)).toEqual([OPENAI, ANTHROPIC, DEEPSEEK])
    expect(rows.map((r) => r.outcome)).toEqual(['failed', 'refused', 'answered'])
    expect(rows.every((r) => r.attempts === 1)).toBe(true)
  })

  it('collapses adjacent same-profile entries, keeping the opening `via` and the last outcome', () => {
    const rows = collapseRouteTrail([
      attempt({ outcome: 'failed', trigger: 'empty-response', detail: 'empty response' }),
      attempt({ via: 'retry', outcome: 'answered', trigger: undefined, detail: undefined }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].attempts).toBe(2)
    // How it came to be asked at all is the FIRST entry's word…
    expect(rows[0].via).toBe('primary')
    // …and what became of it is the LAST entry's.
    expect(rows[0].outcome).toBe('answered')
    expect(rows[0].trigger).toBeUndefined()
    expect(rows[0].detail).toBeUndefined()
  })

  it('does NOT collapse non-adjacent entries for the same profile', () => {
    const rows = collapseRouteTrail([
      attempt(),
      attempt({ profileId: ANTHROPIC, profileName: 'Anthropic Sonnet', provider: 'anthropic', modelName: 'claude-sonnet-5', via: 'understudy' }),
      attempt({ via: 'tier-pick', outcome: 'answered', trigger: undefined, detail: undefined }),
    ])

    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.profileId)).toEqual([OPENAI, ANTHROPIC, OPENAI])
  })

  it('returns nothing for an empty trail', () => {
    expect(collapseRouteTrail([])).toEqual([])
  })
})

describe('describeRouteAttempt', () => {
  const describe1 = (a: Partial<RouteAttempt>) => describeRouteAttempt(collapseRouteTrail([attempt(a)])[0])

  it('names the profile, the provider and the model first', () => {
    expect(describe1({})).toContain('OpenAI gpt-5 · openai: gpt-5 — ')
  })

  it('says how each kind of stand-in came to be asked', () => {
    expect(describe1({ via: 'primary' })).toContain('first on the call sheet')
    expect(describe1({ via: 'retry' })).toContain('asked again on the same profile')
    expect(describe1({ via: 'concierge' })).toContain('sent by the Concierge')
    expect(describe1({ via: 'understudy' })).toContain('stood in as the understudy')
    expect(describe1({ via: 'tier-pick' })).toContain('drafted from the company by tier')
  })

  it('reports a failure with its trigger and detail', () => {
    expect(describe1({ outcome: 'failed', trigger: 'rate-limit', detail: '429 Too Many Requests' }))
      .toBe('OpenAI gpt-5 · openai: gpt-5 — first on the call sheet; fell over: rate-limit (429 Too Many Requests)')
  })

  it('reports a stated refusal with the finish reason', () => {
    expect(describe1({ outcome: 'refused', trigger: 'moderation-refusal', evidence: 'finish-reason', detail: 'finish_reason: content_filter' }))
      .toContain('refused on content grounds (finish_reason: content_filter)')
  })

  it('marks an inferred refusal as inferred, so the user knows which evidence it rests on', () => {
    expect(describe1({ outcome: 'refused', trigger: 'moderation-refusal', evidence: 'inferred', detail: 'empty response on content the Concierge had flagged' }))
      .toContain('refused on content grounds — inferred (empty response on content the Concierge had flagged)')
  })

  it('says plainly that a lone answer answered', () => {
    expect(describe1({ outcome: 'answered', trigger: undefined, detail: undefined })).toContain('; answered')
  })

  it('counts the tries when a run collapsed', () => {
    const [row] = collapseRouteTrail([
      attempt({ outcome: 'failed', trigger: 'empty-response' }),
      attempt({ via: 'retry', outcome: 'answered', trigger: undefined, detail: undefined }),
    ])
    expect(describeRouteAttempt(row)).toContain('answered on the second try')
  })

  it('falls back to a plain count past the named ordinals', () => {
    const [row] = collapseRouteTrail([
      attempt({ outcome: 'failed', trigger: 'empty-response' }),
      attempt({ via: 'retry', outcome: 'failed', trigger: 'empty-response' }),
      attempt({ via: 'retry', outcome: 'failed', trigger: 'empty-response' }),
      attempt({ via: 'retry', outcome: 'failed', trigger: 'empty-response' }),
      attempt({ via: 'retry', outcome: 'failed', trigger: 'empty-response' }),
      attempt({ via: 'retry', outcome: 'answered', trigger: undefined, detail: undefined }),
    ])
    expect(describeRouteAttempt(row)).toContain('answered on try 6')
  })
})

describe('glyphs and labels', () => {
  it('gives a failure and a refusal different marks, and the answer none', () => {
    expect(ROUTE_OUTCOME_GLYPH.failed).toBe('❌')
    expect(ROUTE_OUTCOME_GLYPH.refused).toBe('🚫')
    expect('answered' in ROUTE_OUTCOME_GLYPH).toBe(false)
  })

  it('labels each outcome for a screen reader', () => {
    expect(routeOutcomeLabel('failed')).toBe('failed')
    expect(routeOutcomeLabel('refused')).toBe('refused on content grounds')
    expect(routeOutcomeLabel('answered')).toBe('answered')
  })
})
