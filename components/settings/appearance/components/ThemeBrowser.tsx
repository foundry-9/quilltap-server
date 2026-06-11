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
import useSWR from 'swr'
import { Icon } from '@/components/ui/icon'

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

  const { data: sourcesData, isLoading: isLoadingSourcesData, mutate: mutateSources } = useSWR<{ sources: RegistrySource[] }>(
    isExpanded ? '/api/v1/themes?action=registry-sources' : null
  )

  const { data: themesData, isLoading: isLoadingThemesData, error: themesLoadError, mutate: mutateThemes } = useSWR<{ themes: RegistryTheme[] }>(
    isExpanded ? '/api/v1/themes?action=registry' : null
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by action handlers (filter/delete/update)
    setIsLoadingSources(isLoadingSourcesData)
  }, [isLoadingSourcesData])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by action handlers (filter/delete/update)
    setIsLoadingThemes(isLoadingThemesData)
    if (themesLoadError) {
      setThemesError(themesLoadError instanceof Error ? themesLoadError.message : 'Failed to load themes')
    } else {
      setThemesError(null)
    }
  }, [isLoadingThemesData, themesLoadError])

  useEffect(() => {
    if (sourcesData?.sources) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by action handlers (filter/delete/update)
      setSources(sourcesData.sources)
    }
  }, [sourcesData])

  useEffect(() => {
    if (themesData?.themes) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SWR data must sync to local state that's also mutated by action handlers (filter/delete/update)
      setThemes(themesData.themes)
    }
  }, [themesData])

  const fetchSources = useCallback(() => mutateSources(), [mutateSources])
  const fetchThemes = useCallback(() => mutateThemes(), [mutateThemes])

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
    <section className="border-t qt-border-default pt-8">
      {/* Collapsible Header */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-2 qt-heading-3 text-foreground hover:text-foreground/80 transition-colors"
        >
          <Icon name="chevron-right" className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
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
                <Icon name="refresh" className="w-4 h-4" />
                Refresh
              </>
            )}
          </button>
        )}
      </div>

      {!isExpanded && (
        <p className="qt-text-secondary qt-text-small">
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
                  <Icon name="close" className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 qt-text-secondary pointer-events-none" />
            <input
              type="text"
              placeholder="Search themes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border qt-border-default qt-bg-card text-foreground placeholder:qt-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:qt-border-primary"
            />
          </div>

          {/* Loading state */}
          {isLoadingThemes && (
            <div className="flex items-center justify-center py-12">
              <div className="qt-spinner" />
              <span className="ml-2 qt-text-small qt-text-secondary">
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
                <div className="text-center py-8 qt-text-secondary">
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
          <div className="border-t qt-border-default pt-4 mt-4">
            <div className="flex items-center flex-wrap gap-2">
              <span className="qt-text-label">Sources:</span>

              {isLoadingSources ? (
                <div className="qt-spinner w-3 h-3" />
              ) : sources.length === 0 ? (
                <span className="qt-text-small qt-text-secondary">No sources configured</span>
              ) : (
                sources.map((source) => (
                  <span
                    key={source.name}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md qt-bg-accent text-sm qt-text-on-accent"
                  >
                    {source.name}
                    {source.enabled ? (
                      <Icon
                        name="check"
                        className="w-3.5 h-3.5"
                        style={{ color: 'var(--qt-success, hsl(142, 65%, 40%))' }}
                      />
                    ) : (
                      <Icon
                        name="ban"
                        className="w-3.5 h-3.5 qt-text-secondary"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveSource(source.name)}
                      className="ml-0.5 qt-text-secondary hover:qt-text-destructive transition-colors"
                      title={`Remove ${source.name}`}
                    >
                      <Icon name="close" className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}

              <span className="qt-text-secondary">|</span>

              <button
                type="button"
                onClick={() => setShowAddSource((prev) => !prev)}
                className="qt-button-secondary qt-button-sm flex items-center gap-1"
              >
                <Icon name="plus" className="w-3.5 h-3.5" />
                Add Source
              </button>
            </div>

            {/* Add source form */}
            {showAddSource && (
              <div className="mt-3 p-4 rounded-lg border qt-border-default qt-bg-card space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block qt-text-label mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Community"
                      value={newSourceName}
                      onChange={(e) => setNewSourceName(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-md border qt-border-default bg-background text-foreground placeholder:qt-text-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:qt-border-primary"
                    />
                  </div>
                  <div>
                    <label className="block qt-text-label mb-1">
                      URL
                    </label>
                    <input
                      type="url"
                      placeholder="https://registry.example.com/themes"
                      value={newSourceUrl}
                      onChange={(e) => setNewSourceUrl(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-md border qt-border-default bg-background text-foreground placeholder:qt-text-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:qt-border-primary"
                    />
                  </div>
                </div>
                <div>
                  <label className="block qt-text-label mb-1">
                    Public Key <span className="qt-text-secondary font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="For signature verification"
                    value={newSourceKey}
                    onChange={(e) => setNewSourceKey(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-md border qt-border-default bg-background text-foreground placeholder:qt-text-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:qt-border-primary"
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
    <div className="relative flex flex-col p-4 rounded-lg border-2 qt-border-default qt-bg-card transition-all hover:border-input">
      {/* Theme name */}
      <div className="font-semibold text-base text-foreground">{theme.name}</div>

      {/* Author */}
      {theme.author && (
        <div className="qt-text-small qt-text-secondary mt-0.5">by {theme.author}</div>
      )}

      {/* Description */}
      {theme.description && (
        <div className="text-sm qt-text-secondary mt-1 line-clamp-2">
          {theme.description}
        </div>
      )}

      {/* Color swatches */}
      {swatchColors && (
        <div className="flex items-center gap-1.5 mt-3">
          {swatchColors.map((color, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded-full border qt-border-default"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      )}

      {/* Bottom row: version, badges, install */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t qt-border-default">
        <div className="flex items-center gap-1.5">
          {/* Version */}
          {theme.version && (
            <span className="qt-text-small qt-text-secondary">
              v{theme.version}
            </span>
          )}

          {/* Verified badge */}
          {theme.verified ? (
            <span className="qt-badge inline-flex items-center gap-0.5 text-xs" title="Verified">
              <Icon name="shield" className="w-3 h-3" />
              Verified
            </span>
          ) : (
            <span
              className="qt-badge inline-flex items-center gap-0.5 text-xs opacity-60"
              title="Unverified - not cryptographically signed"
            >
              <Icon name="alert-triangle" className="w-3 h-3" />
              Unverified
            </span>
          )}

          {/* Compatibility indicator */}
          {!theme.compatible && (
            <span
              className="qt-badge inline-flex items-center gap-0.5 text-xs opacity-60"
              title="May not be compatible with this version"
            >
              <Icon name="alert-circle" className="w-3 h-3" />
              Incompatible
            </span>
          )}
        </div>

        {/* Install / Installed button */}
        {theme.installed ? (
          <span className="qt-badge inline-flex items-center gap-1 text-xs">
            <Icon name="check" className="w-3 h-3" />
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
                <Icon name="download" className="w-3.5 h-3.5" />
                Install
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
