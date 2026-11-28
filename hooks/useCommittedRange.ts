'use client'

import { useRef, useState } from 'react'
import type React from 'react'

/**
 * A range input that shows its value live and saves it once the operator lets
 * go — by mouse, touch, pen *or keyboard* (#259).
 *
 * Every `change` (a drag step or an arrow key) becomes the displayed value;
 * the value is committed on pointer release, key release or blur, so a
 * keyboard user's arrow presses are saved the same way a drag is. While a
 * commit is in flight the committed value stays on screen; when it settles the
 * input follows the persisted value again (so a failed save snaps back).
 *
 * Spread `inputProps` onto the `<input type="range">`.
 */
export interface CommittedRange {
  /** What the slider and its label should show. */
  value: number
  inputProps: {
    value: number
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    onPointerUp: () => void
    onMouseUp: () => void
    onTouchEnd: () => void
    onKeyUp: () => void
    onBlur: () => void
  }
}

export function useCommittedRange(options: {
  /** The saved value; shown whenever no change is pending. */
  persisted: number
  /** Save a changed value. Called only when it differs from `persisted`. */
  commit: (value: number) => void | Promise<unknown>
  /** Optional clamp / snap applied to each raw input value. */
  normalize?: (value: number) => number
}): CommittedRange {
  const { persisted, commit, normalize } = options
  const [draft, setDraft] = useState<number | null>(null)
  // The pending value, read synchronously by the commit handlers (several of
  // them can fire for one release: pointerup, mouseup, then blur).
  const pendingRef = useRef<number | null>(null)

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value)
    if (Number.isNaN(raw)) return
    const next = normalize ? normalize(raw) : raw
    pendingRef.current = next
    setDraft(next)
  }

  const flush = () => {
    const next = pendingRef.current
    if (next === null) return
    pendingRef.current = null
    if (next === persisted) {
      setDraft(null)
      return
    }
    let result: void | Promise<unknown>
    try {
      result = commit(next)
    } catch {
      setDraft(null)
      return
    }
    if (result && typeof (result as Promise<unknown>).finally === 'function') {
      // Keep showing the committed value until the save settles, then follow
      // the persisted value — unless a newer change has started meanwhile.
      void (result as Promise<unknown>)
        .catch(() => undefined)
        .finally(() => {
          if (pendingRef.current === null) setDraft(null)
        })
    } else {
      setDraft(null)
    }
  }

  const value = draft ?? persisted

  return {
    value,
    inputProps: {
      value,
      onChange,
      onPointerUp: flush,
      onMouseUp: flush,
      onTouchEnd: flush,
      onKeyUp: flush,
      onBlur: flush,
    },
  }
}
