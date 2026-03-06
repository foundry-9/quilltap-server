'use client'

/**
 * Theme Browser Component
 *
 * Allows users to browse, search, and install themes from remote registries.
 * Displays as a collapsible section below the existing theme selector in
 * Appearance settings.
 *
 * @module components/settings/appearance/components/ThemeBrowser
 */

import { useState, useCallback, useEffect } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

interface ThemeBrowserProps {
  onRefreshThemes?: () => Promise<void>
}

interface RegistryTheme {
  id: string
  name: string
  description?: string
  author?: string
  version?: string
  tags?: string[]
  registryUrl: string
  verified: boolean
  compatible: boolean
  installed: boolean
  previewColors?: {
    light?: { background: string; primary: string; secondary: string; accent: string }
    dark?: { background: string; primary: string; secondary: string; accent: string }
  }
}

interface RegistrySource {
  name: string
  url: string
  enabled: boolean
  publicKey?: string
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Renders the registry theme browser with search, install, and source management
 */
export function ThemeBrowser({ onRefreshThemes }: ThemeBrowserProps) {
  // Expand/collapse state
  const [isExpanded, setIsExpanded] = useState(false)

  // Registry themes
  const [themes, setThemes] = useState<RegistryTheme[]>([])
  const [isLoadingThemes, setIsLoadingThemes] = useState(false)
  const [themesError, setThemesError] = useState<string | null>(null)

  // Registry sources
  const [sources, setSources] = useState<RegistrySource[]>([])
  const [isLoadingSources, setIsLoadingSources] = useState(false)

  // Search
  const [searchQuery, setSearchQuery] = useState('')

  // Installing state per theme
  const [installingThemes, setInstallingThemes] = useState<Set<string>>(new Set())

  // Refreshing registry indexes
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Status message
  const [status, setStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Add source form
  const [showAddSource, setShowAddSource] = useState(false)
  const [newSourceName, setNewSourceName] = useState('')
  const [newSourceUrl, setNewSourceUrl] = useState('')
  const [newSourceKey, setNewSourceKey] = useState('')
  const [isAddingSource, setIsAddingSource] = useState(false)

  // ── Data fetching ──────────────────────────────────────────────────────

  const fetchSources = useCallback(async () => {
    setIsLoadingSources(true)
    try {
      const response = await fetch('/api/v1/themes?action=registry-sources')
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to fetch registry sources')
      }
      const result = await response.json()
      setSources(result.sources ?? [])
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Failed to load registry sources',
        type: 'error',
      })
    } finally {
      setIsLoadingSources(false)
    }
  }, [])

  const fetchThemes = useCallback(async () => {
    setIsLoadingThemes(true)
    setThemesError(null)
    try {
      const response = await fetch('/api/v1/themes?action=registry')
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to fetch registry themes')
      }
      const result = await response.json()
      setThemes(result.themes ?? [])
    } catch (err) {
      setThemesError(err instanceof Error ? err.message : 'Failed to load themes')
    } finally {
      setIsLoadingThemes(false)
    }
  }, [])

  // Lazy load on expand
  useEffect(() => {
    if (isExpanded) {
      fetchSources()
      fetchThemes()
    }
  }, [isExpanded, fetchSources, fetchThemes])

  // ── Actions ────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    setStatus(null)
    try {
      const response = await fetch('/api/v1/themes?action=refresh', { method: 'POST' })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to refresh registries')
      }
      await fetchThemes()
      setStatus({ message: 'Registry indexes refreshed successfully', type: 'success' })
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Failed to refresh registries',
        type: 'error',
      })
    } finally {
      setIsRefreshing(false)
    }
  }, [fetchThemes])

  const handleInstall = useCallback(async (themeId: string, registryUrl: string) => {
    setInstallingThemes((prev) => new Set(prev).add(themeId))
    setStatus(null)
    try {
      const response = await fetch('/api/v1/themes?action=install-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeId, registryUrl }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Installation failed')
      }
      setStatus({ message: `Theme "${themeId}" installed successfully`, type: 'success' })
      // Mark theme as installed locally
      setThemes((prev) =>
        prev.map((t) => (t.id === themeId ? { ...t, installed: true } : t))
      )
      // Refresh the main theme list
      await onRefreshThemes?.()
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Failed to install theme',
        type: 'error',
      })
    } finally {
      setInstallingThemes((prev) => {
        const next = new Set(prev)
        next.delete(themeId)
        return next
      })
    }
  }, [onRefreshThemes])

  const handleAddSource = useCallback(async () => {
    if (!newSourceName.trim() || !newSourceUrl.trim()) return
    setIsAddingSource(true)
    setStatus(null)
    try {
      const body: Record<string, string> = { name: newSourceName.trim(), url: newSourceUrl.trim() }
      if (newSourceKey.trim()) {
        body.publicKey = newSourceKey.trim()
      }
      const response = await fetch('/api/v1/themes?action=add-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to add source')
      }
      setStatus({ message: `Source "${newSourceName}" added successfully`, type: 'success' })
      setNewSourceName('')
      setNewSourceUrl('')
      setNewSourceKey('')
      setShowAddSource(false)
      await fetchSources()
      await fetchThemes()
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Failed to add source',
        type: 'error',
      })
    } finally {
      setIsAddingSource(false)
    }
  }, [newSourceName, newSourceUrl, newSourceKey, fetchSources, fetchThemes])

  const handleRemoveSource = useCallback(async (name: string) => {
    setStatus(null)
    try {
      const response = await fetch('/api/v1/themes?action=remove-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to remove source')
      }
      setStatus({ message: `Source "${name}" removed`, type: 'success' })
      await fetchSources()
      await fetchThemes()
    } catch (err) {
      setStatus({
        message: err instanceof Error ? err.message : 'Failed to remove source',
        type: 'error',
      })
    }
  }, [fetchSources, fetchThemes])

  // ── Filtering ──────────────────────────────────────────────────────────

  const filteredThemes = searchQuery.trim()
    ? themes.filter((theme) => {
        const query = searchQuery.toLowerCase()
        return (
          theme.name.toLowerCase().includes(query) ||
          (theme.description?.toLowerCase().includes(query) ?? false) ||
          (theme.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false) ||
          (theme.author?.toLowerCase().includes(query) ?? false)
        )
      })
    : themes

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <section className="border-t border-border pt-8">
      {/* Collapsible Header */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-2 text-xl font-semibold text-foreground hover:text-foreground/80 transition-colors"
        >
          <svg
            className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Browse Themes
        </button>

        {isExpanded && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="qt-button-secondary qt-button-sm flex items-center gap-1.5"
          >
            {isRefreshing ? (
              <>
                <div className="qt-spinner w-3 h-3" />
                Refreshing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Refresh
              </>
            )}
          </button>
        )}
      </div>

      {!isExpanded && (
        <p className="text-muted-foreground qt-text-small">
          Discover and install themes from remote registries.
        </p>
      )}

      {isExpanded && (
        <div className="space-y-4 mt-4">
          {/* Status message */}
          {status && (
            <div
              className={`qt-alert text-sm ${
                status.type === 'success' ? 'qt-alert-success' : 'qt-alert-error'
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{status.message}</span>
                <button
                  type="button"
                  onClick={() => setStatus(null)}
                  className="ml-2 text-current opacity-60 hover:opacity-100"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search themes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            />
          </div>

          {/* Loading state */}
          {isLoadingThemes && (
            <div className="flex items-center justify-center py-12">
              <div className="qt-spinner" />
              <span className="ml-2 qt-text-small text-muted-foreground">
                Loading registry themes...
              </span>
            </div>
          )}

          {/* Error state */}
          {themesError && !isLoadingThemes && (
            <div className="qt-alert qt-alert-error text-sm">
              <p className="font-medium">Failed to load registry themes</p>
              <p className="qt-text-small mt-1">{themesError}</p>
            </div>
          )}

          {/* Theme grid */}
          {!isLoadingThemes && !themesError && (
            <>
              {filteredThemes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {themes.length === 0 ? (
                    <p>
                      No themes available from configured registries.
                      <br />
                      <span className="qt-text-small">
                        Add a registry source below, or refresh to check for updates.
                      </span>
                    </p>
                  ) : (
                    <p>No themes match your search.</p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredThemes.map((theme) => (
                    <RegistryThemeCard
                      key={`${theme.registryUrl}:${theme.id}`}
                      theme={theme}
                      isInstalling={installingThemes.has(theme.id)}
                      onInstall={() => handleInstall(theme.id, theme.registryUrl)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Sources section */}
          <div className="border-t border-border pt-4 mt-4">
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-sm font-medium text-foreground">Sources:</span>

              {isLoadingSources ? (
                <div className="qt-spinner w-3 h-3" />
              ) : sources.length === 0 ? (
                <span className="qt-text-small text-muted-foreground">No sources configured</span>
              ) : (
                sources.map((source) => (
                  <span
                    key={source.name}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent text-sm text-foreground"
                  >
                    {source.name}
                    {source.enabled ? (
                      <svg
                        className="w-3.5 h-3.5"
                        style={{ color: 'var(--qt-success, hsl(142, 65%, 40%))' }}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-3.5 h-3.5 text-muted-foreground"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                        />
                      </svg>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveSource(source.name)}
                      className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                      title={`Remove ${source.name}`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </span>
                ))
              )}

              <span className="text-muted-foreground">|</span>

              <button
                type="button"
                onClick={() => setShowAddSource((prev) => !prev)}
                className="qt-button-secondary qt-button-sm flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Add Source
              </button>
            </div>

            {/* Add source form */}
            {showAddSource && (
              <div className="mt-3 p-4 rounded-lg border border-border bg-card space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Community"
                      value={newSourceName}
                      onChange={(e) => setNewSourceName(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      URL
                    </label>
                    <input
                      type="url"
                      placeholder="https://registry.example.com/themes"
                      value={newSourceUrl}
                      onChange={(e) => setNewSourceUrl(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Public Key <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="For signature verification"
                    value={newSourceKey}
                    onChange={(e) => setNewSourceKey(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddSource(false)
                      setNewSourceName('')
                      setNewSourceUrl('')
                      setNewSourceKey('')
                    }}
                    className="qt-button-secondary qt-button-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSource}
                    disabled={isAddingSource || !newSourceName.trim() || !newSourceUrl.trim()}
                    className="qt-button-primary qt-button-sm flex items-center gap-1.5"
                  >
                    {isAddingSource ? (
                      <>
                        <div className="qt-spinner w-3 h-3" />
                        Adding...
                      </>
                    ) : (
                      'Add Source'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// ── Registry Theme Card ──────────────────────────────────────────────────

interface RegistryThemeCardProps {
  theme: RegistryTheme
  isInstalling: boolean
  onInstall: () => void
}

/**
 * Individual theme card for a registry theme listing
 */
function RegistryThemeCard({ theme, isInstalling, onInstall }: RegistryThemeCardProps) {
  const colors = theme.previewColors?.dark ?? theme.previewColors?.light
  const swatchColors = colors
    ? [colors.background, colors.primary, colors.secondary, colors.accent]
    : null

  return (
    <div className="relative flex flex-col p-4 rounded-lg border-2 border-border bg-card transition-all hover:border-input">
      {/* Theme name */}
      <div className="font-semibold text-base text-foreground">{theme.name}</div>

      {/* Author */}
      {theme.author && (
        <div className="qt-text-small text-muted-foreground mt-0.5">by {theme.author}</div>
      )}

      {/* Description */}
      {theme.description && (
        <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
          {theme.description}
        </div>
      )}

      {/* Color swatches */}
      {swatchColors && (
        <div className="flex items-center gap-1.5 mt-3">
          {swatchColors.map((color, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded-full border border-border"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      )}

      {/* Bottom row: version, badges, install */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
        <div className="flex items-center gap-1.5">
          {/* Version */}
          {theme.version && (
            <span className="qt-text-small text-muted-foreground">
              v{theme.version}
            </span>
          )}

          {/* Verified badge */}
          {theme.verified ? (
            <span className="qt-badge inline-flex items-center gap-0.5 text-xs" title="Verified">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              Verified
            </span>
          ) : (
            <span
              className="qt-badge inline-flex items-center gap-0.5 text-xs opacity-60"
              title="Unverified - not cryptographically signed"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              Unverified
            </span>
          )}

          {/* Compatibility indicator */}
          {!theme.compatible && (
            <span
              className="qt-badge inline-flex items-center gap-0.5 text-xs opacity-60"
              title="May not be compatible with this version"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Incompatible
            </span>
          )}
        </div>

        {/* Install / Installed button */}
        {theme.installed ? (
          <span className="qt-badge inline-flex items-center gap-1 text-xs">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Installed
          </span>
        ) : (
          <button
            type="button"
            onClick={onInstall}
            disabled={isInstalling || !theme.compatible}
            className="qt-button-primary qt-button-sm flex items-center gap-1"
          >
            {isInstalling ? (
              <>
                <div className="qt-spinner w-3 h-3" />
                Installing...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Install
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
