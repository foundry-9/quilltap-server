/**
 * usePersistentState — a localStorage-mirrored state: read after mount,
 * written back once read, replaced by another tab's write.
 */
import { act, renderHook } from '@testing-library/react'
import { booleanCodec, usePersistentState } from '@/hooks/usePersistentState'

const listCodec = {
  parse: (raw: string) => {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : undefined
  },
  serialize: (value: string[]) => JSON.stringify(value),
}

describe('usePersistentState', () => {
  beforeEach(() => window.localStorage.clear())

  it('starts from the stored value once mounted', () => {
    window.localStorage.setItem('qt.test.flag', 'true')
    const { result } = renderHook(() => usePersistentState('qt.test.flag', false, booleanCodec))
    expect(result.current[0]).toBe(true)
  })

  it('keeps the initial value when nothing is stored, and writes it back', () => {
    const { result } = renderHook(() => usePersistentState('qt.test.flag', false, booleanCodec))
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem('qt.test.flag')).toBe('false')
  })

  it('writes every change under its key', () => {
    const { result } = renderHook(() => usePersistentState('qt.test.flag', false, booleanCodec))
    act(() => result.current[1]((prev) => !prev))
    expect(result.current[0]).toBe(true)
    expect(window.localStorage.getItem('qt.test.flag')).toBe('true')
  })

  it('ignores a stored value the codec rejects', () => {
    window.localStorage.setItem('qt.test.list', '{"not":"a list"}')
    const { result } = renderHook(() => usePersistentState<string[]>('qt.test.list', ['a'], listCodec))
    expect(result.current[0]).toEqual(['a'])
  })

  it('takes another tab’s write to the same key, and ignores other keys and malformed text', () => {
    const { result } = renderHook(() => usePersistentState<string[]>('qt.test.list', [], listCodec))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'qt.other', newValue: '["x"]' }))
    })
    expect(result.current[0]).toEqual([])
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'qt.test.list', newValue: 'not json' }))
    })
    expect(result.current[0]).toEqual([])
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'qt.test.list', newValue: '["b","c"]' }))
    })
    expect(result.current[0]).toEqual(['b', 'c'])
  })
})
