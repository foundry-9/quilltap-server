/**
 * #251: the tag style editor. The emoji is drafted and saved once; a pending
 * colour save cannot undo a Bold ticked meanwhile; a load failure is shown.
 */

import React from 'react'
import { act, screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import TagsTab from '@/components/settings/tags-tab'

jest.mock('@/components/tags/tag-badge', () => ({
  TagBadge: ({ tag }: { tag: { name: string } }) => <span>{tag.name}</span>,
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

const TAG = {
  id: 'tag-1',
  name: 'Villains',
  quickHide: false,
  visualStyle: {
    emoji: null,
    emojiOnly: false,
    foregroundColor: '#111111',
    backgroundColor: '#eeeeee',
    bold: false,
    italic: false,
    strikethrough: false,
  },
  totalUsage: 0,
}

function respond(ok: boolean, body: unknown): Response {
  return { ok, status: ok ? 200 : 500, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response
}

function stubTags(listOk = true) {
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const patch = JSON.parse(String(init.body))
        return Promise.resolve(respond(true, { tag: { ...TAG, ...patch } }))
      }
      return Promise.resolve(
        listOk ? respond(true, { tags: [TAG] }) : respond(false, { error: 'The tag shelf is locked.' }),
      )
    })
}

function putBodies(spy: jest.SpyInstance): Array<{ visualStyle?: Record<string, unknown> }> {
  return spy.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'PUT')
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
}

describe('TagsTab (#251)', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('keeps Bold when a debounced colour save fires after it', async () => {
    const spy = stubTags()
    renderWithQuery(<TagsTab />)
    const fg = (await screen.findByLabelText('Border + Font Color')) as HTMLInputElement

    jest.useFakeTimers()
    fireEvent.change(fg, { target: { value: '#ff0000' } })
    fireEvent.click(screen.getByLabelText('Bold'))
    await act(async () => {
      jest.advanceTimersByTime(600)
    })
    jest.useRealTimers()

    await waitFor(() => expect(putBodies(spy).length).toBeGreaterThan(0))
    const last = putBodies(spy).at(-1)!
    expect(last.visualStyle).toMatchObject({ foregroundColor: '#ff0000', bold: true })
    // The colour went out with the Bold save; no stale save followed it.
    expect(putBodies(spy)).toHaveLength(1)
    await waitFor(() => expect((screen.getByLabelText('Bold') as HTMLInputElement).checked).toBe(true))
  })

  it('sends the colour alone after the debounce, merged into the latest style', async () => {
    const spy = stubTags()
    renderWithQuery(<TagsTab />)
    const bg = (await screen.findByLabelText('Background Color')) as HTMLInputElement

    jest.useFakeTimers()
    fireEvent.change(bg, { target: { value: '#00ff00' } })
    fireEvent.change(bg, { target: { value: '#0000ff' } })
    expect(putBodies(spy)).toHaveLength(0)
    await act(async () => {
      jest.advanceTimersByTime(600)
    })
    jest.useRealTimers()

    await waitFor(() => expect(putBodies(spy)).toHaveLength(1))
    expect(putBodies(spy)[0].visualStyle).toMatchObject({ backgroundColor: '#0000ff', foregroundColor: '#111111' })
  })

  it('keeps every emoji keystroke and saves once on blur', async () => {
    const spy = stubTags()
    renderWithQuery(<TagsTab />)
    const emoji = (await screen.findByLabelText('Emoji')) as HTMLInputElement

    fireEvent.change(emoji, { target: { value: '🦹' } })
    fireEvent.change(emoji, { target: { value: '🦹🔥' } })
    expect(putBodies(spy)).toHaveLength(0)
    expect(emoji.disabled).toBe(false)
    expect(emoji.value).toBe('🦹🔥')

    fireEvent.blur(emoji)
    await waitFor(() => expect(putBodies(spy)).toHaveLength(1))
    expect(putBodies(spy)[0].visualStyle).toMatchObject({ emoji: '🦹🔥' })
  })

  it('shows a load failure with a retry', async () => {
    stubTags(false)
    renderWithQuery(<TagsTab />)
    expect(await screen.findByText('The tag shelf is locked.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
