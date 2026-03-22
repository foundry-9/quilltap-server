'use client'

import { useRef } from 'react'

interface HelpGuideSearchProps {
  value: string
  onChange: (value: string) => void
}

export function HelpGuideSearch({ value, onChange }: HelpGuideSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="qt-help-guide-search">
      <svg className="qt-help-guide-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search topics..."
        className="qt-help-guide-search-input"
        aria-label="Search help topics"
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); inputRef.current?.focus() }}
          className="qt-help-guide-search-clear"
          aria-label="Clear search"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
