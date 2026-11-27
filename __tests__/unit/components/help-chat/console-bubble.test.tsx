/**
 * ConsoleBubble — the shared transcript row of the Help chat and Brahma Console.
 */
import { render, screen } from '@testing-library/react'
import { ConsoleBubble } from '@/components/help-chat/ConsoleBubble'

describe('ConsoleBubble', () => {
  it('draws the avatar and the assistant tail on the assistant side', () => {
    const { container } = render(
      <ConsoleBubble side="assistant" avatar={<span>avatar</span>}>
        <div>Hello</div>
      </ConsoleBubble>,
    )
    expect(screen.getByText('avatar')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('flex-row')
    expect(container.querySelector('svg')).toHaveClass('qt-help-tail', 'qt-help-tail-assistant')
  })

  it('omits the avatar and reverses the row on the user side', () => {
    const { container } = render(
      <ConsoleBubble side="user" avatar={<span>avatar</span>}>
        <div>Hi</div>
      </ConsoleBubble>,
    )
    expect(screen.queryByText('avatar')).toBeNull()
    expect(container.firstElementChild).toHaveClass('flex-row-reverse')
    expect(container.querySelector('svg')).toHaveClass('qt-help-tail-user')
  })
})
