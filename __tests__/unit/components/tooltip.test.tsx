/**
 * The tooltip primitive and the Salon's answer-confirmation badge that leans on
 * it. Both exist because the native `title` attribute proved unreliable under
 * the Electron shell — so the behaviour worth pinning down here is the part the
 * browser used to own: when the bubble appears, when it stays, and when it goes.
 */

import { fireEvent, render, screen, act } from '@testing-library/react'
import { Tooltip } from '@/components/ui/Tooltip'
import { ConfirmationBadge } from '@/app/salon/[id]/components/message-row/ConfirmationBadge'
import type { Message } from '@/app/salon/[id]/types'

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    chatId: 'c1',
    role: 'ASSISTANT',
    content: 'Altitude is reported in feet.',
    createdAt: new Date('2026-08-22T10:00:00Z').toISOString(),
    ...overrides,
  } as Message
}

describe('Tooltip', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers() })

  function hover(element: HTMLElement) {
    fireEvent.pointerEnter(element)
    act(() => { jest.advanceTimersByTime(250) })
  }

  it('stays hidden until the pointer has dwelt on the trigger', () => {
    render(<Tooltip content="Copy message"><button>copy</button></Tooltip>)
    const trigger = screen.getByRole('button', { name: 'copy' })

    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()

    fireEvent.pointerEnter(trigger)
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()

    act(() => { jest.advanceTimersByTime(250) })
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Copy message')
  })

  it('closes when the pointer leaves', () => {
    render(<Tooltip content="Copy message"><button>copy</button></Tooltip>)
    const trigger = screen.getByRole('button', { name: 'copy' })

    hover(trigger)
    fireEvent.pointerLeave(trigger)
    act(() => { jest.advanceTimersByTime(200) })

    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })

  it('keeps a pinned bubble open after the pointer leaves, until Escape', () => {
    render(<Tooltip content="The long story" pinnable><button>badge</button></Tooltip>)
    const trigger = screen.getByRole('button', { name: 'badge' })

    fireEvent.click(trigger)
    expect(screen.getByRole('tooltip', { hidden: true })).toBeInTheDocument()

    fireEvent.pointerLeave(trigger)
    act(() => { jest.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip', { hidden: true })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })

  it('follows its anchor when the page scrolls under it', () => {
    // jsdom measures nothing, so both rects are stood in for: the anchor moves,
    // the bubble keeps a constant size.
    let anchorTop = 500
    const rect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const isBubble = this.classList.contains('qt-tooltip')
        const top = isBubble ? 0 : anchorTop
        const height = isBubble ? 40 : 20
        return { top, bottom: top + height, left: 100, right: 128, width: 28, height, x: 100, y: top, toJSON: () => ({}) } as DOMRect
      })

    try {
      render(<Tooltip content="Copy message"><button>copy</button></Tooltip>)
      hover(screen.getByRole('button', { name: 'copy' }))

      const bubble = screen.getByRole('tooltip', { hidden: true })
      // 500 (anchor top) − 40 (bubble height) − 6 (gap)
      expect(bubble.style.top).toBe('454px')

      anchorTop = 300
      act(() => {
        window.dispatchEvent(new Event('scroll'))
        jest.advanceTimersByTime(50)
      })

      expect(bubble.style.top).toBe('254px')
    } finally {
      rect.mockRestore()
    }
  })

  it('closes when the pointer turns up elsewhere without a pointerleave', () => {
    // The trigger re-rendering under the pointer, or an overlay landing on it,
    // swallows the leave event; the next movement anywhere must still close it.
    render(<><Tooltip content="Copy message"><button>copy</button></Tooltip><div data-testid="elsewhere" /></>)

    hover(screen.getByRole('button', { name: 'copy' }))
    expect(screen.getByRole('tooltip', { hidden: true })).toBeInTheDocument()

    fireEvent.pointerMove(screen.getByTestId('elsewhere'))
    act(() => { jest.advanceTimersByTime(200) })
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })

  it('stays open while the pointer moves over its own trigger', () => {
    render(<Tooltip content="Copy message"><button>copy</button></Tooltip>)
    const trigger = screen.getByRole('button', { name: 'copy' })

    hover(trigger)
    fireEvent.pointerMove(trigger)
    act(() => { jest.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip', { hidden: true })).toBeInTheDocument()
  })

  it('closes on a press elsewhere, pinned or not', () => {
    render(<><Tooltip content="Copy message"><button>copy</button></Tooltip><div data-testid="elsewhere" /></>)

    hover(screen.getByRole('button', { name: 'copy' }))
    fireEvent.pointerDown(screen.getByTestId('elsewhere'))
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })

  it('closes when the window loses focus', () => {
    render(<Tooltip content="Copy message"><button>copy</button></Tooltip>)

    hover(screen.getByRole('button', { name: 'copy' }))
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })

  it('ignores focus that did not come from the keyboard', () => {
    // A click, or a dialog returning focus to its trigger on close: no request
    // for a tooltip, and nothing would ever close one opened that way.
    const realMatches = Element.prototype.matches
    const matches = jest.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? false : realMatches.call(this, selector)
    } as typeof Element.prototype.matches)
    try {
      render(<Tooltip content="Copy message"><button>copy</button></Tooltip>)
      fireEvent.focus(screen.getByRole('button', { name: 'copy' }))
      expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
    } finally {
      matches.mockRestore()
    }
  })

  it('opens on keyboard focus and survives the pointer wandering off', () => {
    const realMatches = Element.prototype.matches
    const matches = jest.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? true : realMatches.call(this, selector)
    } as typeof Element.prototype.matches)
    try {
      render(<><Tooltip content="Copy message"><button>copy</button></Tooltip><div data-testid="elsewhere" /></>)
      const trigger = screen.getByRole('button', { name: 'copy' })

      act(() => { trigger.focus() })
      expect(screen.getByRole('tooltip', { hidden: true })).toBeInTheDocument()

      fireEvent.pointerMove(screen.getByTestId('elsewhere'))
      act(() => { jest.advanceTimersByTime(200) })
      expect(screen.getByRole('tooltip', { hidden: true })).toBeInTheDocument()

      act(() => { trigger.blur() })
      expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
    } finally {
      matches.mockRestore()
    }
  })

  it('does not open from a touch', () => {
    render(<Tooltip content="Copy message"><button>copy</button></Tooltip>)

    // jsdom has no PointerEvent, so the pointerType is stood in for by hand.
    const touch = new MouseEvent('pointerover', { bubbles: true })
    Object.defineProperty(touch, 'pointerType', { value: 'touch' })
    fireEvent(screen.getByRole('button', { name: 'copy' }), touch)
    act(() => { jest.advanceTimersByTime(250) })
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })

  it('does not respond to clicks when it is not pinnable', () => {
    render(<Tooltip content="Copy message"><button>copy</button></Tooltip>)
    const trigger = screen.getByRole('button', { name: 'copy' })

    fireEvent.click(trigger)
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })
})

describe('ConfirmationBadge', () => {
  it('shows nothing when no check ever ran', () => {
    const { container } = render(<ConfirmationBadge message={makeMessage()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('marks a reply the check left alone', () => {
    render(<ConfirmationBadge message={makeMessage({ confirmed: true, confirmationChecked: true })} />)
    expect(screen.getByRole('button')).toHaveTextContent('Vouched')
    expect(screen.getByRole('button')).toHaveAttribute('data-confirmation-state', 'vouched')
  })

  it('surfaces the notes and the original text of an amended reply', () => {
    render(<ConfirmationBadge message={makeMessage({
      confirmed: true,
      confirmationChecked: true,
      confirmationRevised: true,
      confirmationNotes: 'The ledger excerpt shows a metric column.',
      confirmationOriginalContent: 'Altitude is reported in metres.',
    })} />)

    const badge = screen.getByRole('button')
    expect(badge).toHaveAttribute('data-confirmation-state', 'amended')
    // Everything the bubble says is also the badge's accessible name, so the
    // verdict survives for anyone who never hovers.
    expect(badge).toHaveAccessibleName(/The ledger excerpt shows a metric column/)
    expect(badge).toHaveAccessibleName(/Altitude is reported in metres/)

    fireEvent.click(badge)
    const bubble = screen.getByRole('tooltip', { hidden: true })
    expect(bubble).toHaveTextContent('What looked off')
    expect(bubble).toHaveTextContent('Originally written')
  })

  it('offers no pinning on a verdict with nothing further to say', () => {
    render(<ConfirmationBadge message={makeMessage({ confirmed: true, confirmationChecked: true })} />)

    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })

  it('recognises a reloaded unvetted reply from confirmationChecked alone', () => {
    render(<ConfirmationBadge message={makeMessage({ confirmationChecked: true })} />)
    expect(screen.getByRole('button')).toHaveAttribute('data-confirmation-state', 'unvetted')
  })
})
