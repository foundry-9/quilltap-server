'use client'

/**
 * HelpEntityPicker
 *
 * When a help navigation link contains a parameterised URL (e.g. /aurora/:id/edit),
 * this component fetches the relevant entity list and lets the user pick one.
 * Once selected, the :id param is replaced with the real ID and navigation proceeds.
 */

import { useState, useMemo } from 'react'
import useSWR from 'swr'

/** Maps URL param patterns to their entity type and API source */
interface ParamRoute {
  /** Regex that matches the full URL and captures the param position */
  pattern: RegExp
  /** Human-readable entity type for the picker title */
  entityLabel: string
  /** API endpoint to fetch the list */
  apiUrl: string
  /** Key in the API response that holds the array */
  responseKey: string
  /** How to extract label + id from each item */
  getLabel: (item: Record<string, unknown>) => string
  getId: (item: Record<string, unknown>) => string
  /** Replace param in original URL template with real id */
  buildUrl: (urlTemplate: string, id: string) => string
}

const PARAM_ROUTES: ParamRoute[] = [
  {
    pattern: /^\/aurora\/:id(\/|$)/,
    entityLabel: 'Character',
    apiUrl: '/api/v1/characters',
    responseKey: 'characters',
    getLabel: (item) => (item.name as string) || 'Unnamed',
    getId: (item) => item.id as string,
    buildUrl: (tpl, id) => tpl.replace(':id', id),
  },
  {
    pattern: /^\/salon\/:id(\/|$)/,
    entityLabel: 'Chat',
    apiUrl: '/api/v1/chats',
    responseKey: 'chats',
    getLabel: (item) => (item.title as string) || 'Untitled chat',
    getId: (item) => item.id as string,
    buildUrl: (tpl, id) => tpl.replace(':id', id),
  },
  {
    pattern: /^\/prospero\/:id(\/|$)/,
    entityLabel: 'Project',
    apiUrl: '/api/v1/projects',
    responseKey: 'projects',
    getLabel: (item) => (item.name as string) || 'Unnamed project',
    getId: (item) => item.id as string,
    buildUrl: (tpl, id) => tpl.replace(':id', id),
  },
]

/**
 * Check whether a URL contains parameterised segments that need resolution.
 */
export function hasParamSegments(url: string): boolean {
  return PARAM_ROUTES.some(r => r.pattern.test(url))
}

/**
 * Find the matching route config for a parameterised URL.
 */
export function findParamRoute(url: string): ParamRoute | null {
  return PARAM_ROUTES.find(r => r.pattern.test(url)) || null
}

interface EntityItem {
  id: string
  label: string
}

interface HelpEntityPickerProps {
  /** The parameterised URL template, e.g. /aurora/:id/edit */
  urlTemplate: string
  /** Called with the resolved (real) URL once the user picks an entity */
  onSelect: (resolvedUrl: string) => void
  /** Called when the user dismisses the picker */
  onCancel: () => void
}

export function HelpEntityPicker({ urlTemplate, onSelect, onCancel }: HelpEntityPickerProps) {
  const route = useMemo(() => findParamRoute(urlTemplate), [urlTemplate])
  const [filter, setFilter] = useState('')

  const { data: fetchedData, isLoading, error: loadError } = useSWR<Record<string, unknown>>(
    route ? route.apiUrl : null
  )

  const items = useMemo(() => {
    if (!route || !fetchedData) return []
    const list = (fetchedData[route.responseKey] as Record<string, unknown>[]) || []
    return list.map((item: Record<string, unknown>) => ({
      id: route.getId(item),
      label: route.getLabel(item),
    }))
  }, [route, fetchedData])

  const error = !route ? 'Unknown entity type' : (loadError ? (loadError instanceof Error ? loadError.message : 'Failed to load') : null)
  const loading = isLoading

  const filtered = useMemo(() => {
    if (!filter) return items
    const lower = filter.toLowerCase()
    return items.filter((i: EntityItem) => i.label.toLowerCase().includes(lower))
  }, [items, filter])

  const handleSelect = (id: string) => {
    if (!route) return
    onSelect(route.buildUrl(urlTemplate, id))
  }

  return (
    <div className="qt-help-entity-picker-backdrop" onClick={onCancel}>
      <div
        className="qt-help-entity-picker"
        onClick={e => e.stopPropagation()}
      >
        <div className="qt-help-entity-picker-header">
          <span>Select a {route?.entityLabel || 'item'}</span>
          <button
            type="button"
            onClick={onCancel}
            className="p-0.5 rounded hover:bg-accent qt-text-secondary hover:text-foreground transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {items.length > 5 && (
          <div className="px-2 pb-1">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={`Filter ${route?.entityLabel?.toLowerCase() || 'item'}s...`}
              className="qt-help-entity-picker-filter"
              autoFocus
            />
          </div>
        )}

        <div className="qt-help-entity-picker-list">
          {loading && (
            <div className="text-xs qt-text-secondary text-center py-3 italic">
              Loading...
            </div>
          )}
          {error && (
            <div className="text-xs qt-text-destructive text-center py-3">
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="text-xs qt-text-secondary text-center py-3">
              {filter ? 'No matches' : `No ${route?.entityLabel?.toLowerCase() || 'item'}s found`}
            </div>
          )}
          {filtered.map((item: EntityItem) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id)}
              className="qt-help-entity-picker-item"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
