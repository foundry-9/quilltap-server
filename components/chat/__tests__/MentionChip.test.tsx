/**
 * The Salon's name chip: a marked name renders as a chip inside the line's
 * roleplay styling, and its card appears on focus or hover.
 */

import React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import MessageContent from '@/components/chat/MessageContent'
import type { AbsentMentionChip } from '@/components/chat/MentionChip'
import { renderWithQuery as render } from '../../../__tests__/helpers/renderWithQuery'

jest.mock('remark-gfm', () => () => undefined)
jest.mock('remark-breaks', () => () => undefined)
jest.mock('remark-math', () => () => undefined)
jest.mock('rehype-katex', () => () => undefined)
jest.mock('remark-smartypants', () => () => undefined)
jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}))
jest.mock('react-syntax-highlighter/dist/cjs/styles/prism', () => ({ oneDark: {} }))
// A one-paragraph markdown stand-in that runs the rehype plugins it is given,
// so the marker pass reaches the paragraph renderer as it does in the app.
jest.mock('react-markdown', () => {
  const React = require('react')
  function ReactMarkdownMock({
    children,
    components = {},
    rehypePlugins = [],
  }: {
    children: string
    components?: Record<string, any>
    rehypePlugins?: unknown[]
  }) {
    const tree = { type: 'root', children: [{ type: 'element', tagName: 'p', children: [{ type: 'text', value: String(children) }] }] }
    for (const entry of rehypePlugins) {
      const [plugin, options] = Array.isArray(entry) ? entry : [entry, undefined]
      const transform = (plugin as (o: unknown) => ((t: unknown) => void) | undefined)(options)
      transform?.(tree)
    }
    const Paragraph = components.p ?? ((props: any) => React.createElement('p', props, props.children))
    return React.createElement(Paragraph, null, tree.children[0].children[0].value)
  }
  return { __esModule: true, default: ReactMarkdownMock, defaultUrlTransform: (url: string) => url }
})

const abby: AbsentMentionChip = {
  characterId: 'abigail',
  text: 'Abby',
  card: { name: 'Abigail', aliases: ['Abby', 'True North'], pronouns: 'she/her/her', body: 'Abigail keeps the records.' },
}

describe('MentionChip in MessageContent', () => {
  it('chips the first mention inside the dialogue styling, and only once', () => {
    const { container } = render(
      <MessageContent content={'"When Abby is not scolding Vergil." Abby grins.'} mentions={[abby]} />,
    )
    const chips = container.querySelectorAll('.qt-mention-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0].textContent).toBe('Abby')
    // The quote is still one styled dialogue run, with the chip inside it.
    const dialogue = chips[0].closest('.qt-chat-dialogue')
    expect(dialogue?.textContent).toBe('"When Abby is not scolding Vergil."')
    expect(container.textContent).not.toMatch(/[-]/)
  })

  it('shows the card on focus', () => {
    render(<MessageContent content="Abby came by." mentions={[abby]} />)
    act(() => {
      fireEvent.focus(screen.getByRole('button', { name: 'Abigail, not in this conversation' }))
    })
    const tooltip = screen.getByRole('tooltip', { hidden: true })
    expect(tooltip.textContent).toContain('Abigail')
    expect(tooltip.textContent).toContain('Abby, True North')
    expect(tooltip.textContent).toContain('she/her/her')
    expect(tooltip.textContent).toContain('Abigail keeps the records.')
  })

  it('renders plainly without mentions', () => {
    const { container } = render(<MessageContent content="Abby came by." />)
    expect(container.querySelector('.qt-mention-chip')).toBeNull()
  })
})
