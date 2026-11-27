/**
 * SegmentedRadioGroup: one tab stop, arrow keys / Home / End move and
 * choose, disabled options are skipped, clicks choose.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { SegmentedRadioGroup, segmentedButtonClass } from '@/components/ui/SegmentedRadioGroup'

type V = 'a' | 'b' | 'c'

const OPTIONS = [
  { value: 'a' as const, label: 'Alpha' },
  { value: 'b' as const, label: 'Beta', title: 'The second' },
  { value: 'c' as const, label: 'Gamma' },
]

function renderGroup(props: Partial<React.ComponentProps<typeof SegmentedRadioGroup<V>>> = {}) {
  const onSelect = jest.fn()
  render(
    <SegmentedRadioGroup<V>
      options={OPTIONS}
      value="b"
      onSelect={onSelect}
      ariaLabel="Letters"
      optionClassName={segmentedButtonClass('sm')}
      {...props}
    />,
  )
  return { onSelect, radios: screen.getAllByRole('radio') }
}

describe('SegmentedRadioGroup', () => {
  it('is a named radio group whose chosen option is checked and the only tab stop', () => {
    const { radios } = renderGroup()
    expect(screen.getByRole('radiogroup', { name: 'Letters' })).toBeInTheDocument()
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1])
    expect(radios[1]).toHaveAttribute('title', 'The second')
    expect(radios[1].className).toContain('qt-button-primary')
    expect(radios[0].className).toContain('qt-button-ghost')
  })

  it('makes the first enabled option the tab stop when nothing (enabled) is chosen', () => {
    const { radios } = renderGroup({ value: null, options: [{ ...OPTIONS[0], disabled: true }, OPTIONS[1], OPTIONS[2]] })
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1])
  })

  it('chooses on click', () => {
    const { onSelect, radios } = renderGroup()
    fireEvent.click(radios[2])
    expect(onSelect).toHaveBeenCalledWith('c')
  })

  it('moves focus and chooses with the arrow keys, wrapping round', () => {
    const { onSelect, radios } = renderGroup()
    fireEvent.keyDown(radios[1], { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('c')
    expect(radios[2]).toHaveFocus()
    fireEvent.keyDown(radios[2], { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenLastCalledWith('a')
    fireEvent.keyDown(radios[0], { key: 'ArrowLeft' })
    expect(onSelect).toHaveBeenLastCalledWith('c')
    fireEvent.keyDown(radios[1], { key: 'ArrowUp' })
    expect(onSelect).toHaveBeenLastCalledWith('a')
  })

  it('goes to the ends with Home and End', () => {
    const { onSelect, radios } = renderGroup()
    fireEvent.keyDown(radios[1], { key: 'End' })
    expect(onSelect).toHaveBeenLastCalledWith('c')
    fireEvent.keyDown(radios[1], { key: 'Home' })
    expect(onSelect).toHaveBeenLastCalledWith('a')
  })

  it('skips a disabled option and ignores other keys', () => {
    const { onSelect, radios } = renderGroup({ options: [OPTIONS[0], OPTIONS[1], { ...OPTIONS[2], disabled: true }] })
    fireEvent.keyDown(radios[1], { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('a')
    onSelect.mockClear()
    fireEvent.keyDown(radios[1], { key: 'a' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('disables every option when the group is disabled', () => {
    const { radios } = renderGroup({ disabled: true })
    radios.forEach((r) => expect(r).toBeDisabled())
  })

  it('draws the extra-small size', () => {
    expect(segmentedButtonClass('xs')('a', false)).toBe('px-2 py-1 text-xs qt-button qt-button-ghost')
    expect(segmentedButtonClass('xs')('a', true)).toBe('px-2 py-1 text-xs qt-button qt-button-primary')
  })
})
