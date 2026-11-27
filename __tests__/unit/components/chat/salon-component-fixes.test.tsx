/**
 * Salon component regressions:
 *
 * - #254 — while another character spoke, a card's button read "Nudge" and its
 *   nudge was refused; it now queues.
 * - #281 — the delete dialog always said "1 swipes".
 * - #288 — a failed whisper said nothing.
 */

import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery as render } from '../../../helpers/renderWithQuery'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showInfoToast: jest.fn(),
}))
jest.mock('@/components/ui/Avatar', () => ({
  __esModule: true,
  default: function MockAvatar({ name }: { name: string }) {
    return <div data-testid="avatar">{name}</div>
  },
}))

import { ParticipantCard, type ParticipantData } from '@/components/chat/ParticipantCard'
import { MemoryCascadeDialog } from '@/components/ui/MemoryCascadeDialog'
import { WhisperDialog } from '@/components/chat/WhisperDialog'
import { showErrorToast } from '@/lib/toast'

const fetchMock = global.fetch as jest.Mock

const echo: ParticipantData = {
  id: 'p-echo',
  type: 'CHARACTER',
  displayOrder: 1,
  isActive: true,
  character: { id: 'c-echo', name: 'Echo', title: null, avatarUrl: null, defaultImage: null },
  connectionProfile: { id: 'prof', name: 'GPT', provider: 'openai', modelName: 'gpt' },
} as unknown as ParticipantData

beforeEach(() => {
  jest.clearAllMocks()
  fetchMock.mockReset()
})

describe('ParticipantCard while someone else speaks (#254)', () => {
  it('reads "Queue" and queues instead of nudging', () => {
    const onQueue = jest.fn()
    const onNudge = jest.fn()
    render(
      <ParticipantCard
        participant={echo}
        isCurrentTurn={false}
        queuePosition={0}
        isGenerating={false}
        roomIsGenerating
        onNudge={onNudge}
        onQueue={onQueue}
        onDequeue={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Queue/ }))
    expect(onQueue).toHaveBeenCalledWith('p-echo')
    expect(onNudge).not.toHaveBeenCalled()
  })

  it('still nudges when the room is quiet', () => {
    const onNudge = jest.fn()
    render(
      <ParticipantCard
        participant={echo}
        isCurrentTurn={false}
        queuePosition={0}
        isGenerating={false}
        onNudge={onNudge}
        onQueue={jest.fn()}
        onDequeue={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Nudge/ }))
    expect(onNudge).toHaveBeenCalledWith('p-echo')
  })
})

describe('MemoryCascadeDialog swipe count (#281)', () => {
  it('counts the swipes and singularises one', () => {
    const { rerender } = render(
      <MemoryCascadeDialog isOpen memoryCount={2} isSwipeGroup swipeCount={3} onClose={jest.fn()} onConfirm={jest.fn()} />,
    )
    expect(screen.getByText(/has 3 swipes with a total of 2 associated memories/)).toBeInTheDocument()

    rerender(
      <MemoryCascadeDialog isOpen memoryCount={1} isSwipeGroup swipeCount={1} onClose={jest.fn()} onConfirm={jest.fn()} />,
    )
    expect(screen.getByText(/has 1 swipe with a total of 1 associated memory/)).toBeInTheDocument()
  })
})

describe('WhisperDialog failure (#288)', () => {
  it('says so and keeps the dialog and its text', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    const onClose = jest.fn()
    const onSent = jest.fn()
    render(
      <WhisperDialog
        isOpen
        targetName="Echo"
        targetParticipantId="p-echo"
        chatId="chat-1"
        onClose={onClose}
        onSent={onSent}
      />,
    )

    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'psst' } })
    fireEvent.click(screen.getByRole('button', { name: 'Whisper' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(onSent).not.toHaveBeenCalled()
    expect(box).toHaveValue('psst')
  })
})
