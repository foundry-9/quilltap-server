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
            className="px-3 py-1.5 rounded-lg qt-bg-warning/10 text-warning text-sm font-medium hover:qt-bg-warning/20 qt-shadow-sm"
          >
            Click to reveal flagged content
          </button>
        </div>
      </div>
    )
  }

  // COLLAPSE mode
  return (
    <div className="border border-warning/30 rounded-lg p-3 qt-bg-warning/10">
      <button
        onClick={() => setRevealed(true)}
        className="text-sm text-warning hover:underline"
      >
        [Flagged Content - Click to reveal]
      </button>
    </div>
  )
}
