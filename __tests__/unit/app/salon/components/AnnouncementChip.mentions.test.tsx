/**
 * AnnouncementChip — a collapsed announcement that holds the first mention of
 * an Atlas thing or an absent character carries those chips beside its bar,
 * since the body that would hold them is hidden. Without any, the bar is drawn
 * alone, as before.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import { AnnouncementChip } from '@/app/salon/[id]/components/AnnouncementChip'

// react-markdown and remark-gfm are ESM-only; the Atlas card renders through them.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }))
const mockAtlas = jest.fn()
const mockAbsent = jest.fn()
jest.mock('@/hooks/useAtlasMentions', () => ({
  useAtlasMentions: (...args: unknown[]) => mockAtlas(...args),
}))
jest.mock('@/hooks/useAbsentMentions', () => ({
  useAbsentMentions: (...args: unknown[]) => mockAbsent(...args),
}))

const scenarioRow = {
  id: 'msg-scenario',
  role: 'ASSISTANT',
  content: 'The Host sets the scene: the Berline waits by the gate.',
  createdAt: '2026-11-11T15:56:52.267Z',
  attachments: [],
  participantId: null,
  systemSender: 'host',
  systemKind: 'scenario',
} as never

describe('AnnouncementChip name chips', () => {
  beforeEach(() => {
    mockAtlas.mockReset().mockReturnValue([])
    mockAbsent.mockReset().mockReturnValue([])
  })

  it('draws the bar alone when nothing is first named in it', () => {
    const { container } = render(
      <AnnouncementChip message={scenarioRow} chatId="chat-1" onToggleExpanded={() => {}} />,
    )
    expect(container.querySelector('.qt-chat-announcement-chip-wrap')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(mockAtlas).toHaveBeenCalledWith('chat-1', 'msg-scenario')
  })

  it('puts thing and person chips beside the bar, named by their cards, outside its button', () => {
    mockAtlas.mockReturnValue([{
      kind: 'thing',
      entryId: 'entry-berline',
      text: 'Berline',
      card: { entryId: 'entry-berline', name: 'Berline', aliases: [], graphicPrompt: null, knowledge: null, origin: { scope: 'general' }, imageFileId: null },
    }])
    mockAbsent.mockReturnValue([{
      characterId: 'char-marie',
      text: 'Grandma',
      card: { name: 'Marie', aliases: ['Grandma'], pronouns: null, facts: [], body: '' },
    }])
    const onToggle = jest.fn()
    const { container } = render(
      <AnnouncementChip message={scenarioRow} chatId="chat-1" onToggleExpanded={onToggle} />,
    )
    const wrap = container.querySelector('.qt-chat-announcement-chip-wrap')
    expect(wrap).not.toBeNull()
    const bar = container.querySelector('button.qt-chat-announcement-chip')!
    const thing = screen.getByRole('button', { name: 'Berline, from the Atlas' })
    const person = screen.getByRole('button', { name: 'Marie, not in this conversation' })
    expect(bar.contains(thing)).toBe(false)
    expect(bar.contains(person)).toBe(false)
    expect(thing).toHaveTextContent('Berline')
    expect(person).toHaveTextContent('Marie')

    fireEvent.click(bar)
    expect(onToggle).toHaveBeenCalledWith('msg-scenario')
  })
})
