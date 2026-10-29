'use client'

/**
 * BrahmaConsoleLauncher
 *
 * The always-on Brahma Console button: pinned to the bottom-left of the app,
 * just right of the left rail, in the topmost floating layer so it stays
 * visible and clickable over any portal modal. It toggles the floating
 * {@link BrahmaConsoleDialog}. It is never disabled — with no connection
 * profile the console opens to a note saying so.
 *
 * @module components/brahma-console/BrahmaConsoleLauncher
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui/icon'
import { floatingLayerProps } from '@/components/ui/floating-layer'
import { useBrahmaConsole } from '@/components/providers/brahma-console-provider'

export function BrahmaConsoleLauncher() {
  const { isOpen, toggleConsole } = useBrahmaConsole()
  // Portal target exists only after mount (hydration-safe).
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag for the portal
  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  const label = isOpen ? 'Hide the Brahma Console' : 'Open the Brahma Console'

  return createPortal(
    <button
      type="button"
      onClick={toggleConsole}
      className={`qt-brahma-launcher${isOpen ? ' qt-brahma-launcher-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={isOpen}
      {...floatingLayerProps}
    >
      <Icon name="brahma-console" className="qt-brahma-launcher-icon" />
    </button>,
    document.body
  )
}
