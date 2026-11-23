/**
 * UncensoredBadge — the one mark every gallery draws on a picture an
 * uncensored profile painted.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { UncensoredBadge } from '@/components/images/UncensoredBadge'

describe('UncensoredBadge', () => {
  it.each([null, undefined, 'moderated'] as const)('renders nothing for %p', (moderation) => {
    const { container } = render(<UncensoredBadge moderation={moderation} />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['uncensored-profile', /of your own choosing/],
    ['uncensored-routed', /by the Concierge/],
    ['uncensored-failover', /house painter declined/],
  ] as const)('labels %s and explains it', (moderation, detail) => {
    const { container } = render(<UncensoredBadge moderation={moderation} className="absolute top-1" />)
    const badge = container.querySelector('.qt-uncensored-badge') as HTMLElement
    expect(badge).not.toBeNull()
    expect(badge.className).toContain('absolute top-1')
    expect(badge.getAttribute('title')).toMatch(detail)
    expect(badge.dataset.generationModeration).toBe(moderation)
    expect(screen.getByText('Uncensored')).toBeInTheDocument()
  })
})
