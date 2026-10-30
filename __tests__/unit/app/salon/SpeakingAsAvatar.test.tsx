/**
 * Unit tests for the SpeakingAsAvatar composer cue.
 *
 * Covers the two behaviours the feature promises:
 * - it always names the character the human is speaking as (tooltip/aria-label)
 *   and shows their portrait,
 * - it renders at full brightness when the human may type and dims to near-dark
 *   while a reply is in flight (Bug 46 cue).
 */

import { describe, it, expect } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { SpeakingAsAvatar } from '@/app/salon/[id]/components/SpeakingAsAvatar'

describe('SpeakingAsAvatar', () => {
  it('names and pictures the character being spoken as, bright when the human may type', async () => {
    render(
      <SpeakingAsAvatar
        name="Charlie"
        src={{ avatarUrl: '/files/charlie.webp' }}
        canType
      />,
    )

    const cue = screen.getByLabelText('Speaking as Charlie')
    expect(cue).not.toHaveAttribute('title')
    fireEvent.pointerEnter(cue)
    expect(await screen.findByRole('tooltip', { hidden: true })).toHaveTextContent('Speaking as Charlie')
    expect(cue.className).toContain('opacity-100')
    expect(cue.className).not.toContain('brightness-50')

    const img = screen.getByAltText('Charlie') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/files/charlie.webp')
  })

  it('dims to near-dark while a reply is in flight', async () => {
    render(<SpeakingAsAvatar name="Charlie" canType={false} />)

    const cue = screen.getByLabelText('Speaking as Charlie, waiting for the room')
    fireEvent.pointerEnter(cue)
    expect(await screen.findByRole('tooltip', { hidden: true }))
      .toHaveTextContent('Speaking as Charlie — waiting for the room')
    expect(cue.className).toContain('brightness-50')
  })

  it('shows no Deus Ex Machina toggle unless the composer hands it one', () => {
    render(<SpeakingAsAvatar name="Charlie" canType />)
    expect(screen.queryByRole('button', { name: 'Deus Ex Machina' })).toBeNull()
  })

  it('seats a Deus Ex Machina toggle that reports and flips the armed state', async () => {
    const onToggle = jest.fn()
    const { rerender } = render(
      <SpeakingAsAvatar name="Charlie" canType establishedFact={{ armed: false, onToggle }} />,
    )

    const toggle = screen.getByRole('button', { name: 'Deus Ex Machina' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).not.toHaveAttribute('title')
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(<SpeakingAsAvatar name="Charlie" canType establishedFact={{ armed: true, onToggle }} />)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerEnter(toggle)
    expect(await screen.findByRole('tooltip', { hidden: true })).toHaveTextContent('Deus Ex Machina is armed')
  })

  it('keeps the toggle out of the dimmed layer while a reply is in flight', () => {
    render(
      <SpeakingAsAvatar name="Charlie" canType={false} establishedFact={{ armed: false, onToggle: () => {} }} />,
    )
    const cue = screen.getByLabelText('Speaking as Charlie, waiting for the room')
    const toggle = screen.getByRole('button', { name: 'Deus Ex Machina' })
    expect(cue.contains(toggle)).toBe(false)
    expect(toggle).not.toBeDisabled()
  })

  it('falls back to the initial when there is no portrait', () => {
    render(<SpeakingAsAvatar name="Charlie" canType />)
    expect(screen.getByText('C')).toBeInTheDocument()
  })
})
