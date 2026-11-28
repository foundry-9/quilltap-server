/**
 * useCharacterOptimizer.applyChanges reports its own outcome (#238).
 *
 * The modal used to read `optimizer.error` after awaiting the apply, but the
 * closure held the error from the render it was made in — so a failed apply
 * showed "Refinements Commissioned" and closed, and a successful retry after a
 * failure never did. The hook now resolves `true` / `false` and the modal
 * branches on that.
 */

import { renderHook, act } from '@testing-library/react'
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util'

import { useCharacterOptimizer } from '@/components/characters/optimizer/hooks/useCharacterOptimizer'

if (typeof globalThis.TextDecoder === 'undefined') {
  ;(globalThis as any).TextDecoder = NodeTextDecoder
}
const Encoder = (globalThis.TextEncoder ?? NodeTextEncoder) as typeof NodeTextEncoder

const CHARACTER_ID = 'char-1'

const SUGGESTION = {
  id: 's1',
  field: 'identity',
  currentValue: 'old',
  proposedValue: 'new',
  rationale: 'because',
}

/** A streamed optimize response that ends with one suggestion. */
function streamResponse() {
  const bytes = new Encoder().encode(
    `data: ${JSON.stringify({ type: 'done', suggestions: [SUGGESTION] })}\n\n`,
  )
  let sent = false
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined }
          sent = true
          return { done: false, value: bytes }
        },
      }),
    },
  }
}

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

let fetchSpy: jest.Mock
const originalFetch = global.fetch

beforeEach(() => {
  fetchSpy = jest.fn()
  ;(global as any).fetch = fetchSpy
})
afterEach(() => {
  ;(global as any).fetch = originalFetch
})

async function reviewWithOneAccepted() {
  fetchSpy.mockResolvedValueOnce(streamResponse())
  const hook = renderHook(() => useCharacterOptimizer())
  await act(async () => {
    await hook.result.current.startOptimization(CHARACTER_ID, 'profile-1')
  })
  expect(hook.result.current.phase).toBe('review')
  act(() => hook.result.current.decideSuggestion('s1', 'accepted'))
  return hook
}

describe('useCharacterOptimizer.applyChanges', () => {
  it('resolves false and sets the error when a write fails', async () => {
    const { result } = await reviewWithOneAccepted()
    fetchSpy.mockResolvedValueOnce(json(500, { error: 'nope' }))

    let applied: boolean | undefined
    await act(async () => {
      applied = await result.current.applyChanges(CHARACTER_ID)
    })

    expect(applied).toBe(false)
    expect(result.current.error).toMatch(/could not retrieve/i)
    expect(result.current.applying).toBe(false)
  })

  it('resolves true on a successful retry after a failure', async () => {
    const { result } = await reviewWithOneAccepted()
    fetchSpy.mockResolvedValueOnce(json(500, {}))
    await act(async () => {
      await result.current.applyChanges(CHARACTER_ID)
    })
    expect(result.current.error).not.toBeNull()

    fetchSpy.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? json(200, { character: { id: CHARACTER_ID } })
        : json(200, { character: { id: CHARACTER_ID, identity: 'old' } }),
    )
    let applied: boolean | undefined
    await act(async () => {
      applied = await result.current.applyChanges(CHARACTER_ID)
    })

    expect(applied).toBe(true)
    expect(result.current.error).toBeNull()
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true)
  })
})
