/**
 * useResizableDivider — the Salon's shared pane-divider behaviour: a drag
 * hands its position up once, on mouse-up; keys hand it up at once; every
 * value passes through the caller's clamp.
 */

import { useResizableDivider } from '@/app/salon/[id]/components/useResizableDivider'
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

const clamp = (raw: number) => Math.max(20, Math.min(80, Math.round(raw)))

function Divider({ axis, onChange, keyboardEnabled }: { axis: 'x' | 'y'; onChange: (p: number) => void; keyboardEnabled?: boolean }) {
  const { containerRef, splitPos, handleMouseDown, handleKeyDown } = useResizableDivider({
    axis,
    position: 50,
    onPositionChange: onChange,
    clamp,
    bounds: { min: 20, max: 80 },
    keyboardEnabled,
  })
  return (
    <div ref={containerRef} data-testid="container">
      <div role="separator" tabIndex={0} aria-valuenow={splitPos} onMouseDown={handleMouseDown} onKeyDown={handleKeyDown} />
    </div>
  )
}

function sizeContainer(width: number, height: number) {
  const el = screen.getByTestId('container')
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
}

describe('useResizableDivider', () => {
  it('steps by 5 on the axis keys and jumps to the bounds on Home and End', () => {
    const onChange = jest.fn()
    render(<Divider axis="x" onChange={onChange} />)
    const sep = screen.getByRole('separator')
    fireEvent.keyDown(sep, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(45)
    fireEvent.keyDown(sep, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(55)
    fireEvent.keyDown(sep, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(sep, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(20)
    fireEvent.keyDown(sep, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(80)
  })

  it('uses Up and Down on the vertical axis', () => {
    const onChange = jest.fn()
    render(<Divider axis="y" onChange={onChange} />)
    const sep = screen.getByRole('separator')
    fireEvent.keyDown(sep, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(45)
    fireEvent.keyDown(sep, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('ignores keys when the keyboard is off', () => {
    const onChange = jest.fn()
    render(<Divider axis="x" onChange={onChange} keyboardEnabled={false} />)
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('tracks a drag live and commits the clamped position on mouse-up only', () => {
    const onChange = jest.fn()
    render(<Divider axis="x" onChange={onChange} />)
    sizeContainer(1000, 500)
    const sep = screen.getByRole('separator')
    fireEvent.mouseDown(sep)
    expect(document.body.style.cursor).toBe('col-resize')
    fireEvent.mouseMove(document, { clientX: 300 })
    expect(sep.getAttribute('aria-valuenow')).toBe('30')
    fireEvent.mouseMove(document, { clientX: 950 })
    expect(sep.getAttribute('aria-valuenow')).toBe('80')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.mouseUp(document)
    expect(onChange).toHaveBeenCalledWith(80)
    expect(document.body.style.cursor).toBe('')
  })
})
