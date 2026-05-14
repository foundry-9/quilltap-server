'use client'

import { useCallback, useState } from 'react'

/**
 * "Click → copied!" state machine. Calls `navigator.clipboard.writeText` and
 * flips `copied` true for {@link revertAfterMs} so the caller can swap an
 * icon or label. Falls back to a hidden textarea + `document.execCommand`
 * for browsers without the Clipboard API.
 *
 * @example
 *   const { copied, copy } = useCopyToClipboard()
 *   <button onClick={() => copy(someText)}>{copied ? 'Copied' : 'Copy'}</button>
 */
export function useCopyToClipboard(revertAfterMs: number = 2000): {
  copied: boolean
  copy: (text: string) => Promise<boolean>
} {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (text: string): Promise<boolean> => {
    const succeed = () => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), revertAfterMs)
      return true
    }

    try {
      await navigator.clipboard.writeText(text)
      return succeed()
    } catch {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(textarea)
        return ok ? succeed() : false
      } catch (err) {
        console.error('Failed to copy to clipboard', { error: err instanceof Error ? err.message : String(err) })
        return false
      }
    }
  }, [revertAfterMs])

  return { copied, copy }
}
