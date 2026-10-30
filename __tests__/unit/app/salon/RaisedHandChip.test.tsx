/**
 * Unit tests for the raised-hand status chip above the Salon composer.
 *
 * The soft interrupt used to give no word between the button's pulse and a
 * passing toast. The chip must say each step — raised, being weighed, and
 * how it was answered — and its × must lower a hand still up but only
 * dismiss an outcome.
 */

import { describe, it, expect, jest } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { RaisedHandChip } from '@/app/salon/[id]/components/RaisedHandChip'

describe('RaisedHandChip', () => {
  it('renders nothing without a status', () => {
    const { container } = render(<RaisedHandChip status={null} onLower={jest.fn()} onDismiss={jest.fn()} />)
    expect(container.textContent).toBe('')
  })

  it('says the hand is up, and its × lowers it', () => {
    const onLower = jest.fn()
    const onDismiss = jest.fn()
    render(<RaisedHandChip status={{ kind: 'raised' }} onLower={onLower} onDismiss={onDismiss} />)

    expect(screen.getByText(/Hand raised/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Lower your hand'))
    expect(onLower).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('names the speaker weighing the hand, with nothing to click', () => {
    render(
      <RaisedHandChip
        status={{ kind: 'asked', characterName: 'Clementine' }}
        onLower={jest.fn()}
        onDismiss={jest.fn()}
      />,
    )
    expect(screen.getByText('Clementine is weighing your raised hand…')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it.each([
    [{ kind: 'yielded' as const, characterName: 'Clementine' }, 'Clementine yields the floor — it is yours'],
    [{ kind: 'declined' as const, characterName: 'Clementine' }, 'Clementine carried on regardless; your hand is lowered'],
    [{ kind: 'unasked' as const }, 'The room fell quiet before anyone was asked — the floor is yours'],
  ])('reports the outcome %#, and its × only dismisses', (status, text) => {
    const onLower = jest.fn()
    const onDismiss = jest.fn()
    render(<RaisedHandChip status={status} onLower={onLower} onDismiss={onDismiss} />)

    expect(screen.getByText(text)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dismiss the raised-hand note'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onLower).not.toHaveBeenCalled()
  })
})
