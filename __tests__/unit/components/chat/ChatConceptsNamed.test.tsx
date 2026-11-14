/**
 * ChatConceptsNamed — the chat sidebar's "Concepts Named" card: the absent
 * characters and Atlas entries the chat names, each going to its first mention
 * on click.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import { ChatConceptsNamed } from '@/components/chat/ChatConceptsNamed'
import { requestMessageReveal } from '@/lib/chat/message-navigation'
import type { ChatAbsentMention } from '@/hooks/useAbsentMentions'
import type { AtlasMention } from '@/lib/schemas/atlas.types'

// react-markdown and remark-gfm are ESM-only; the Atlas card renders through them.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }))
jest.mock('@/lib/chat/message-navigation', () => ({ requestMessageReveal: jest.fn() }))

function thing(over: Partial<AtlasMention> & { name: string }): AtlasMention {
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

function person(over: Partial<ChatAbsentMention> & { name: string }): ChatAbsentMention {
  const { name, ...rest } = over
  return {
    messageId: `msg-${name}`,
    characterId: `char-${name}`,
    text: name,
    card: { name, aliases: [], pronouns: null, facts: [], body: '' },
    avatarUrl: null,
    ...rest,
  }
}

describe('ChatConceptsNamed', () => {
  beforeEach(() => jest.clearAllMocks())

  it('draws nothing when the chat names nobody and nothing', () => {
    const { container } = render(<ChatConceptsNamed chatId="chat-1" people={[]} things={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('groups characters not here before Atlas entries, each in order, with the word used when it is not the name', () => {
    render(
      <ChatConceptsNamed
        chatId="chat-1"
        people={[person({ name: 'Marie', text: 'Grandma' })]}
        things={[thing({ name: 'Berline' }), thing({ name: 'The Covenant', text: 'ship' })]}
      />,
    )
    expect(screen.getByRole('region', { name: 'Characters not here' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'From the Atlas' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'Marie: go to where it is first named',
      'Berline: go to where it is first named',
      'The Covenant: go to where it is first named',
    ])
    expect(screen.getByText('as “Grandma”')).toBeInTheDocument()
    expect(screen.getByText('as “ship”')).toBeInTheDocument()
    expect(screen.queryByText('as “Berline”')).not.toBeInTheDocument()
  })

  it('leaves out a group with nothing in it', () => {
    render(<ChatConceptsNamed chatId="chat-1" people={[person({ name: 'Marie' })]} things={[]} />)
    expect(screen.getByRole('region', { name: 'Characters not here' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'From the Atlas' })).not.toBeInTheDocument()
  })

  it('shows the portrait or entry picture when there is one', () => {
    const berline = thing({ name: 'Berline' })
    berline.card.imageFileId = 'file-9'
    const { container } = render(
      <ChatConceptsNamed chatId="chat-1" people={[person({ name: 'Marie', avatarUrl: '/api/v1/mount-points/mp/blobs/images/marie.webp' })]} things={[berline]} />,
    )
    expect([...container.querySelectorAll('img')].map(i => i.getAttribute('src'))).toEqual([
      '/api/v1/mount-points/mp/blobs/images/marie.webp',
      '/api/v1/files/file-9?action=thumbnail',
    ])
  })

  it('asks the Salon to reveal the first mention, then tells the sidebar', () => {
    const onRevealed = jest.fn()
    render(
      <ChatConceptsNamed
        chatId="chat-1"
        people={[person({ name: 'Marie', messageId: 'msg-7' })]}
        things={[thing({ name: 'The Covenant', messageId: 'msg-42' })]}
        onRevealed={onRevealed}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /The Covenant/ }))
    expect(requestMessageReveal).toHaveBeenLastCalledWith('chat-1', 'msg-42')
    fireEvent.click(screen.getByRole('button', { name: /Marie/ }))
    expect(requestMessageReveal).toHaveBeenLastCalledWith('chat-1', 'msg-7')
    expect(onRevealed).toHaveBeenCalledTimes(2)
  })
})
