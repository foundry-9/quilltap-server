'use client'

import { RefObject } from 'react'
import { EntityOption } from './useEntitySearch'

interface EntitySearchDropdownProps {
  isDropdownOpen: boolean
  setIsDropdownOpen: (open: boolean) => void
  searchTerm: string
  setSearchTerm: (term: string) => void
  filteredEntities: EntityOption[]
  onEntitySelect: (entity: EntityOption) => void
  dropdownRef: RefObject<HTMLDivElement | null>
  disabled: boolean
}

export function EntitySearchDropdown({
  isDropdownOpen,
  setIsDropdownOpen,
  searchTerm,
  setSearchTerm,
  filteredEntities,
  onEntitySelect,
  dropdownRef,
  disabled,
}: EntitySearchDropdownProps) {
  return (
    <div className="relative pt-4" ref={dropdownRef}>
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className="w-full px-3 py-2 text-sm text-foreground qt-bg-muted hover:qt-bg-muted/80 rounded border border-input transition-colors flex items-center justify-between"
        disabled={disabled}
      >
        <span>Other Characters...</span>
        <svg className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isDropdownOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-background border qt-border-default rounded-lg qt-shadow-lg max-h-64 overflow-hidden flex flex-col z-10">
          <div className="p-2 border-b qt-border-default">
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="qt-input"
            />
          </div>
          <div className="overflow-y-auto">
            {filteredEntities.map(entity => (
              <button
                key={entity.id}
                onClick={() => onEntitySelect(entity)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
              >
                <span className={`px-1.5 py-0.5 text-xs rounded ${
                  entity.type === 'character'
                    ? 'bg-accent text-accent-foreground'
                    : 'qt-bg-primary/20 text-primary'
                }`}>
                  {entity.type === 'character' ? 'C' : 'P'}
                </span>
                <span className="text-foreground">{entity.name}</span>
              </button>
            ))}
            {filteredEntities.length === 0 && (
              <div className="px-3 py-4 qt-text-small text-center">
                No matches found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
