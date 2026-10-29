/**
 * LazyMessageContent and diagrams: a message with a closed diagram fence must
 * leave the server-pre-rendered fast path (whose HTML shows the fence as a
 * highlighted code block) and reach MessageContent, carrying its author's
 * diagram style. Everything else keeps the fast path.
 */

import { render, screen } from '@testing-library/react'
import LazyMessageContent from '@/components/chat/LazyMessageContent'

// The real MessageContent pulls in ESM-only react-markdown; the stand-in
// records which path was taken and what it was handed.
jest.mock('@/components/chat/MessageContent', () => ({
  __esModule: true,
  default: ({ diagrams }: { diagrams?: { style: string; streaming?: boolean } }) => (
    <div
      data-testid="full-render"
      data-diagram-style={diagrams?.style ?? ''}
      data-diagram-streaming={String(diagrams?.streaming ?? false)}
    />
  ),
}))

const FENCED = 'Here it is:\n\n```mermaid\nflowchart TD\n  A --> B\n```'
const HTML = '<p>pre-rendered</p>'

describe('LazyMessageContent — diagrams', () => {
  it('keeps the pre-rendered fast path for a message without a diagram', () => {
    const { container } = render(<LazyMessageContent content="Just prose." renderedHtml={HTML} />)
    expect(screen.queryByTestId('full-render')).not.toBeInTheDocument()
    expect(container.innerHTML).toContain('pre-rendered')
  })

  it('keeps the fast path for an ordinary code fence', () => {
    render(<LazyMessageContent content={'```ts\nconst x = 1\n```'} renderedHtml={HTML} />)
    expect(screen.queryByTestId('full-render')).not.toBeInTheDocument()
  })

  it('takes the full render for a closed diagram fence, even with pre-rendered HTML', () => {
    render(<LazyMessageContent content={FENCED} renderedHtml={HTML} diagramStyle="handDrawn" />)
    const full = screen.getByTestId('full-render')
    expect(full).toHaveAttribute('data-diagram-style', 'handDrawn')
    expect(full).toHaveAttribute('data-diagram-streaming', 'false')
  })

  it('draws in the clean style when no author style is given', () => {
    render(<LazyMessageContent content={FENCED} />)
    expect(screen.getByTestId('full-render')).toHaveAttribute('data-diagram-style', 'clean')
  })
})
