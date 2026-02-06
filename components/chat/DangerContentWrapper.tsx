'use client'

import { useState, type ReactNode } from 'react'

interface DangerContentWrapperProps {
  displayMode: 'SHOW' | 'BLUR' | 'COLLAPSE'
  children: ReactNode
}

export function DangerContentWrapper({ displayMode, children }: DangerContentWrapperProps) {
  const [revealed, setRevealed] = useState(false)

  if (displayMode === 'SHOW' || revealed) {
    return <>{children}</>
  }

  if (displayMode === 'BLUR') {
    return (
      <div className="relative">
        <div className="blur-md select-none pointer-events-none">
          {children}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            onClick={() => setRevealed(true)}
            className="px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 text-sm font-medium hover:bg-amber-200 dark:hover:bg-amber-900/80 shadow-sm"
          >
            Click to reveal flagged content
          </button>
        </div>
      </div>
    )
  }

  // COLLAPSE mode
  return (
    <div className="border border-amber-300 dark:border-amber-700 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-950/30">
      <button
        onClick={() => setRevealed(true)}
        className="text-sm text-amber-800 dark:text-amber-200 hover:underline"
      >
        [Flagged Content - Click to reveal]
      </button>
    </div>
  )
}
