/**
 * The shared generate call and the caret-aware placeholder insert.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { insertAtCursor, useGenerateImage } from '@/components/images/generate-image'

const mockFetch = global.fetch as jest.Mock

describe('insertAtCursor', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('replaces the selection with {{text}} and puts the caret after it', () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.value = 'a portrait of X at dusk'
    textarea.setSelectionRange(14, 15)

    const next = insertAtCursor(textarea, 'me')
    expect(next).toBe('a portrait of {{me}} at dusk')

    textarea.value = next
    jest.runAllTimers()
    expect(textarea.selectionStart).toBe(20)
    expect(textarea.selectionEnd).toBe(20)
    textarea.remove()
  })
})

describe('useGenerateImage', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: [] }) })
  })

  it('posts the trimmed prompt, count and chat to the profile generate action', async () => {
    const { result } = renderHook(() => useGenerateImage('prof-1'), (createQueryWrapper()))
    await act(async () => {
      await result.current.mutateAsync({ prompt: '  a gramophone  ', count: 2, chatId: 'chat-9' })
    })
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/v1/image-profiles/prof-1?action=generate')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ prompt: 'a gramophone', count: 2, chatId: 'chat-9' })
  })

  it('leaves chatId out when there is none', async () => {
    const { result } = renderHook(() => useGenerateImage('prof-1'), (createQueryWrapper()))
    await act(async () => {
      await result.current.mutateAsync({ prompt: 'x', count: 1 })
    })
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ prompt: 'x', count: 1 })
  })
})
