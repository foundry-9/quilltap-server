import { act, renderHook } from '@testing-library/react'
import { useDraft, jsonEqual } from '@/lib/hooks/use-draft'

describe('useDraft', () => {
  it('adopts a new server value while clean', () => {
    const { result, rerender } = renderHook(({ v }) => useDraft(v), { initialProps: { v: 'a' } })
    rerender({ v: 'b' })
    expect(result.current[0]).toBe('b')
    expect(result.current[2].dirty).toBe(false)
  })

  it('keeps a dirty draft across a server change, and reset discards it', () => {
    const { result, rerender } = renderHook(({ v }) => useDraft(v), { initialProps: { v: 'a' } })
    act(() => result.current[1]('typed'))
    rerender({ v: 'b' })
    expect(result.current[0]).toBe('typed')
    expect(result.current[2].dirty).toBe(true)
    act(() => result.current[2].reset())
    expect(result.current[0]).toBe('b')
    expect(result.current[2].dirty).toBe(false)
  })

  it('becomes clean when the server value lands equal to the draft (a save)', () => {
    const { result, rerender } = renderHook(({ v }) => useDraft(v), { initialProps: { v: { n: 1 } } })
    act(() => result.current[1]({ n: 2 }))
    rerender({ v: { n: 2 } })
    expect(result.current[2].dirty).toBe(false)
    rerender({ v: { n: 3 } })
    expect(result.current[0]).toEqual({ n: 3 })
  })

  it('does not adopt for a structurally equal value', () => {
    const { result, rerender } = renderHook(({ v }) => useDraft(v), { initialProps: { v: { a: [1, 2] } } })
    act(() => result.current[1]({ a: [9] }))
    rerender({ v: { a: [1, 2] } })
    expect(result.current[0]).toEqual({ a: [9] })
  })

  it('jsonEqual ignores undefined keys', () => {
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(jsonEqual([1, { x: 'y' }], [1, { x: 'y' }])).toBe(true)
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false)
  })
})
