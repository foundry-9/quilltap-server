/**
 * The settings-mode wizard re-run (#268): Save keeps an unchanged part,
 * updates the same row when only its model moved, and creates under a free
 * name otherwise — never a second profile under a taken name.
 */

import { planProfileWrite, type DesiredProfile } from '@/components/setup-wizard/profile-plan'

const autoName = (d: DesiredProfile) => `${d.provider} - ${d.model}`
const existing = { id: 'p1', name: 'OPENAI - gpt-5', provider: 'OPENAI', model: 'gpt-5' }

describe('planProfileWrite', () => {
  it('keeps a part whose provider and model are unchanged', () => {
    expect(planProfileWrite(existing, { provider: 'OPENAI', model: 'gpt-5' }, autoName, [existing.name])).toEqual({
      kind: 'keep',
      id: 'p1',
    })
  })

  it('updates the same row when only the model changed, renaming a wizard-named profile', () => {
    expect(planProfileWrite(existing, { provider: 'OPENAI', model: 'gpt-6' }, autoName, [existing.name])).toEqual({
      kind: 'update',
      id: 'p1',
      name: 'OPENAI - gpt-6',
    })
  })

  it('keeps a name the operator chose when updating the model', () => {
    const named = { ...existing, name: 'My writer' }
    expect(planProfileWrite(named, { provider: 'OPENAI', model: 'gpt-6' }, autoName, ['My writer'])).toEqual({
      kind: 'update',
      id: 'p1',
      name: 'My writer',
    })
  })

  it('creates under a free name when the provider changed or nothing was preloaded', () => {
    const plan = planProfileWrite(existing, { provider: 'ANTHROPIC', model: 'x' }, autoName, ['ANTHROPIC - x'])
    expect(plan.kind).toBe('create')
    expect(plan.kind === 'create' && plan.name).not.toBe('ANTHROPIC - x')
    expect(planProfileWrite(undefined, { provider: 'OPENAI', model: 'gpt-5' }, autoName, [])).toEqual({
      kind: 'create',
      name: 'OPENAI - gpt-5',
    })
  })
})
