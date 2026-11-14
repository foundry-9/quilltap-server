/**
 * Regression: the engine drops a draft as its save resolves, but the cached
 * row reaches React a tick later. For that render the field must keep showing
 * what was typed — a Markdown editor shown the old stored value ('') reads it
 * as its parent clearing it and wipes itself (seen live on V4test).
 */

import { renderHook } from '@testing-library/react'
import { useHeldValue } from '@/app/aurora/[id]/components/autosave-bindings'

describe('useHeldValue', () => {
  it('holds the last draft until the stored value moves', () => {
    const { result, rerender } = renderHook(
      ({ hasDraft, draft, stored }) => useHeldValue(hasDraft, draft, stored),
      { initialProps: { hasDraft: true, draft: 'Brave', stored: '' } },
    )
    expect(result.current).toBe('Brave')
    // Save resolved: draft gone, cache not yet updated.
    rerender({ hasDraft: false, draft: '', stored: '' })
    expect(result.current).toBe('Brave')
    // Cache caught up.
    rerender({ hasDraft: false, draft: '', stored: 'Brave' })
    expect(result.current).toBe('Brave')
    // Someone else writes later: shown.
    rerender({ hasDraft: false, draft: '', stored: 'Bold' })
    expect(result.current).toBe('Bold')
  })

  it('shows the stored value when there was never a draft', () => {
    const { result } = renderHook(() => useHeldValue(false, '', 'stored'))
    expect(result.current).toBe('stored')
  })
})
