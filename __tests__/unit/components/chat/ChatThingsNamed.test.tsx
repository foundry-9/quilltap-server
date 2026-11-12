/**
 * ChatThingsNamed — the chat sidebar's "Things named" card: every Atlas entry
 * the chat names, in order, each going to its first mention on click.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import { ChatThingsNamed } from '@/components/chat/ChatThingsNamed'
import { requestMessageReveal } from '@/lib/chat/message-navigation'
import type { AtlasMention } from '@/lib/schemas/atlas.types'

// react-markdown and remark-gfm are ESM-only; the Atlas card renders through them.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }))
jest.mock('@/lib/chat/message-navigation', () => ({ requestMessageReveal: jest.fn() }))

function mention(over: Partial<AtlasMention> & { name: string }): AtlasMention {
  const { name, ...rest } = over
  return {
    messageId: `msg-${name}`,
    entryId: `entry-${name}`,
    text: name,
    card: {
      entryId: `entry-${name}`,
      name,
      aliases: [],
      graphicPrompt: null,
      knowledge: null,
      origin: { scope: 'general' },
      imageFileId: null,
    },
    ...rest,
  } as AtlasMention
}

describe('ChatThingsNamed', () => {
  beforeEach(() => jest.clearAllMocks())

  it('draws nothing when the chat names nothing', () => {
    const { container } = render(<ChatThingsNamed chatId="chat-1" mentions={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each entry in order, with the word it was named by when that is not its name', () => {
    render(
      <ChatThingsNamed
        chatId="chat-1"
        mentions={[mention({ name: 'Berline' }), mention({ name: 'The Covenant', text: 'ship' })]}
      />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual([
      'Berline: go to where it is first named',
      'The Covenant: go to where it is first named',
    ])
    expect(screen.getByText('as “ship”')).toBeInTheDocument()
    expect(screen.queryByText('as “Berline”')).not.toBeInTheDocument()
  })

  it('shows the entry picture when it has one', () => {
    const m = mention({ name: 'Berline' })
    m.card.imageFileId = 'file-9'
    const { container } = render(<ChatThingsNamed chatId="chat-1" mentions={[m]} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/v1/files/file-9?action=thumbnail')
  })

  it('asks the Salon to reveal the first mention, then tells the sidebar', () => {
    const onRevealed = jest.fn()
    render(
      <ChatThingsNamed
        chatId="chat-1"
        mentions={[mention({ name: 'The Covenant', messageId: 'msg-42' })]}
        onRevealed={onRevealed}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /The Covenant/ }))
    expect(requestMessageReveal).toHaveBeenCalledWith('chat-1', 'msg-42')
    expect(onRevealed).toHaveBeenCalledTimes(1)
  })
})
