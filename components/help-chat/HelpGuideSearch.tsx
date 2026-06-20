'use client'

import { useRef } from 'react'
import { Icon } from '@/components/ui/icon'

interface HelpGuideSearchProps {
  value: string
  onChange: (value: string) => void
}

export function HelpGuideSearch({ value, onChange }: HelpGuideSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="qt-help-guide-search">
      <Icon name="search" className="qt-help-guide-search-icon" />
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
          <Icon name="close" className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
