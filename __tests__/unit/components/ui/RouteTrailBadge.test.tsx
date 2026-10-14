/**
 * The call sheet under an assistant avatar: order, marks, and strikes.
 */

import { describe, it, expect } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import React from 'react'

// The badge inside each row asks the provider registry for an icon; the trail
// itself is what is under test, so stub the network away and let it fall
// through to the letter avatar.
jest.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({ getProviderIcon: () => null, providers: [], loading: false }),
}))

import { RouteTrailBadge } from '@/components/ui/RouteTrailBadge'
import type { RouteAttempt } from '@/lib/schemas/chat.types'

const PRIMARY: RouteAttempt = {
  profileId: '00000000-0000-4000-8000-00000000000a',
  profileName: 'OpenAI gpt-5',
  provider: 'openai',
  modelName: 'gpt-5',
  via: 'primary',
  outcome: 'failed',
  trigger: 'network',
  detail: 'Connection error.',
}

const REFUSED: RouteAttempt = {
  profileId: '00000000-0000-4000-8000-00000000000b',
  profileName: 'Anthropic Sonnet',
  provider: 'anthropic',
  modelName: 'claude-sonnet-5',
  via: 'understudy',
  outcome: 'refused',
  trigger: 'moderation-refusal',
  evidence: 'finish-reason',
  detail: 'finish_reason: refusal',
}

const ANSWERED: RouteAttempt = {
  profileId: '00000000-0000-4000-8000-00000000000c',
  profileName: 'DeepSeek',
  provider: 'deepseek',
  modelName: 'deepseek-v4-pro',
  via: 'tier-pick',
  outcome: 'answered',
}

describe('RouteTrailBadge', () => {
  it('lists every profile tried, first asked at the top', () => {
    render(<RouteTrailBadge routeTrail={[PRIMARY, REFUSED, ANSWERED]} />)

    const rows = screen.getByRole('list', { name: 'Models tried for this reply' })
      .querySelectorAll('li')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('gpt-5')
    expect(rows[1].textContent).toContain('claude-sonnet-5')
    expect(rows[2].textContent).toContain('deepseek-v4-pro')
  })

  it('strikes through only the rows that did not answer', () => {
    const { container } = render(<RouteTrailBadge routeTrail={[PRIMARY, REFUSED, ANSWERED]} />)

    const struck = Array.from(container.querySelectorAll('s'))
    expect(struck).toHaveLength(2)
    expect(struck[0].textContent).toContain('gpt-5')
    expect(struck[1].textContent).toContain('claude-sonnet-5')
  })

  it('marks a self-inflicted failure ❌ and a content refusal 🚫', () => {
    render(<RouteTrailBadge routeTrail={[PRIMARY, REFUSED, ANSWERED]} />)

    expect(screen.getByLabelText('failed').textContent).toBe('❌')
    expect(screen.getByLabelText('refused on content grounds').textContent).toBe('🚫')
    expect(screen.queryByLabelText('answered')).toBeNull()
  })

  it('carries the full explanation as each row\'s hover text', () => {
    render(<RouteTrailBadge routeTrail={[PRIMARY, ANSWERED]} />)

    expect(screen.getByTitle(
      'OpenAI gpt-5 · openai: gpt-5 — first on the call sheet; fell over: network (Connection error.)'
    )).toBeInTheDocument()
    expect(screen.getByTitle(
      'DeepSeek · deepseek: deepseek-v4-pro — drafted from the company by tier; answered'
    )).toBeInTheDocument()
  })

  it('renders a one-row trail with no mark and no strike, as the plain badge would', () => {
    const { container } = render(<RouteTrailBadge routeTrail={[ANSWERED]} />)

    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(container.querySelector('s')).toBeNull()
    expect(container.textContent).not.toContain('❌')
    expect(container.textContent).not.toContain('🚫')
  })

  it('collapses the same-profile retry into one row that says it answered second time', () => {
    const retried: RouteAttempt = { ...PRIMARY, via: 'retry', outcome: 'answered', trigger: undefined, detail: undefined }
    const { container } = render(<RouteTrailBadge routeTrail={[PRIMARY, retried]} />)

    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(container.querySelector('s')).toBeNull()
    expect(screen.getByTitle(
      'OpenAI gpt-5 · openai: gpt-5 — first on the call sheet; answered on the second try'
    )).toBeInTheDocument()
  })

  it('renders nothing for an empty trail', () => {
    const { container } = render(<RouteTrailBadge routeTrail={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
