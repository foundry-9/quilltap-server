/**
 * SlideOverPanel stays mounted while closed (parked off-screen so it can slide
 * in). Closed, it must be inert: otherwise its controls sit in the Tab order
 * beyond the viewport edge and the focus trap holds keyboard users there.
 */

import { render, screen } from '@testing-library/react'
import { SlideOverPanel } from '@/components/ui/SlideOverPanel'

function renderPanel(isOpen: boolean) {
  return render(
    <SlideOverPanel isOpen={isOpen} onClose={jest.fn()} title="Inspector">
      <button type="button">Inside</button>
    </SlideOverPanel>,
  )
}

describe('SlideOverPanel inert when closed', () => {
  it('marks the closed panel inert', () => {
    renderPanel(false)
    const panel = document.querySelector('.qt-slide-over-panel') as HTMLElement
    expect(panel).toHaveAttribute('inert')
    expect(panel).toHaveAttribute('data-open', 'false')
  })

  it('leaves the open panel interactive', () => {
    renderPanel(true)
    const panel = screen.getByRole('dialog', { name: 'Inspector' })
    expect(panel).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Inside' })).toBeInTheDocument()
  })
})
