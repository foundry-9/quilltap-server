import type { KeyboardEvent } from 'react'

/**
 * Keyboard activation for an element given `role="button"` (WCAG 2.1.1).
 *
 * Enter or Space dispatches a real click on the element, so it reaches the
 * same `onClick` a pointer does — its own, or a card's or row's further up.
 * Used where a native `<button>` won't do: inside a `<tr>`, or around text
 * that themes would restyle as a command (two bundled themes set every
 * `button` in tracked capitals).
 *
 * @example
 * <span role="button" tabIndex={0} onKeyDown={activateOnKey}>{name}</span>
 */
export function activateOnKey(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Enter' && e.key !== ' ') return
  if (e.target !== e.currentTarget) return
  e.preventDefault()
  e.currentTarget.click()
}
