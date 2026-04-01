'use client'

import { useState, useEffect, useCallback } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BrandName } from '@/components/ui/brand-name'
import { clientLogger } from '@/lib/client-logger'

type PluginSource = 'included' | 'npm' | 'git' | 'manual' | 'bundled' | 'site' | 'user'
type ActiveTab = 'installed' | 'browse'

interface Plugin {
  name: string
  title: string
  version: string
  enabled: boolean
  capabilities: string[]
  path: string
  source: PluginSource
}

interface InstalledPlugin {
  name: string
  title: string
  version: string
  description?: string
  author?: { name: string; email?: string; url?: string }
  source: 'bundled' | 'site' | 'user'
  capabilities: string[]
  installedAt?: string
}

interface NpmPlugin {
  name: string
  version: string
  description: string
  author?: string
  keywords?: string[]
  updated: string
  score: number
}

interface PluginStats {
  total: number
  enabled: number
  disabled: number
  errors: number
  initialized: boolean
}

const getSourceBadge = (source: PluginSource) => {
  switch (source) {
    case 'included':
    case 'bundled':
      return {
        label: 'Bundled',
        className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
      }
    case 'npm':
      return {
        label: 'NPM',
        className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
      }
    case 'site':
      return {
        label: 'Site',
        className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      }
    case 'user':
      return {
        label: 'Personal',
        className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
      }
    case 'git':
      return {
        label: 'Git',
        className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
      }
    case 'manual':
      return {
        label: 'Manual',
        className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
      }
    default:
      return {
        label: 'Unknown',
        className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
      }
  }
}

export default function PluginsTab() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('installed')
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([])
  const [stats, setStats] = useState<PluginStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<Set<string>>(new Set())

  // Browse state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NpmPlugin[]>([])
  const [searching, setSearching] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const fetchPlugins = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins')
      if (!res.ok) throw new Error('Failed to fetch plugins')
      const data = await res.json()
      setPlugins(data.plugins || [])
      setStats(data.stats || null)
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to load plugins')
    }
  }, [])

  const fetchInstalledPlugins = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/installed')
      if (!res.ok) throw new Error('Failed to fetch installed plugins')
      const data = await res.json()
      setInstalledPlugins(data.plugins || [])
    } catch (err) {
      // Silently fail for installed plugins list, use main plugins list as fallback
      clientLogger.debug('Failed to fetch installed plugins', { error: err })
    }
  }, [])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      await Promise.all([fetchPlugins(), fetchInstalledPlugins()])
      setLoading(false)
    }
    loadData()
  }, [fetchPlugins, fetchInstalledPlugins])

  const handleTogglePlugin = async (pluginName: string, currentEnabled: boolean) => {
    setToggling(prev => new Set(prev).add(pluginName))
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(pluginName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentEnabled }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update plugin')
      }

      setPlugins(prev =>
        prev.map(p =>
          p.name === pluginName ? { ...p, enabled: !currentEnabled } : p
        )
      )

      if (stats) {
        setStats({
          ...stats,
          enabled: stats.enabled + (currentEnabled ? -1 : 1),
          disabled: stats.disabled + (currentEnabled ? 1 : -1),
        })
      }

      showSuccessToast(
        !currentEnabled ? 'Plugin enabled successfully' : 'Plugin disabled successfully'
      )
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to update plugin')
    } finally {
      setToggling(prev => {
        const next = new Set(prev)
        next.delete(pluginName)
        return next
      })
    }
  }

  const searchNpmPlugins = async () => {
    if (searching) return

    setSearching(true)
    try {
      const params = new URLSearchParams()
      if (searchQuery.trim()) {
        params.set('q', searchQuery.trim())
      }

      const res = await fetch(`/api/plugins/search?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Search failed')
      }

      const data = await res.json()
      setSearchResults(data.plugins || [])
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to search plugins')
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const installPlugin = async (packageName: string, scope: 'site' | 'user' = 'user') => {
    setActionInProgress(packageName)
    try {
      const res = await fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName, scope }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Installation failed')
      }

      showSuccessToast(data.message || 'Plugin installed successfully!')

      // Refresh installed plugins list
      await fetchInstalledPlugins()

    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Installation failed')
    } finally {
      setActionInProgress(null)
    }
  }

  const uninstallPlugin = async (packageName: string, source: string) => {
    if (source === 'bundled' || source === 'included') {
      showErrorToast('Cannot uninstall bundled plugins')
      return
    }

    const scope = source === 'site' ? 'site' : 'user'

    setActionInProgress(packageName)
    try {
      const res = await fetch('/api/plugins/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName, scope }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Uninstall failed')
      }

      showSuccessToast(data.message || 'Plugin uninstalled successfully!')

      // Refresh installed plugins list
      await fetchInstalledPlugins()
      await fetchPlugins()

    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Uninstall failed')
    } finally {
      setActionInProgress(null)
    }
  }

  const isPluginInstalled = (packageName: string): boolean => {
    return installedPlugins.some(p => p.name === packageName) ||
           plugins.some(p => p.name === packageName)
  }

  const canUninstall = (source: string): boolean => {
    return source === 'site' || source === 'user' || source === 'npm'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-r-transparent"></div>
          <p className="text-muted-foreground">Loading plugins...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Header */}
      {stats && (
        <div className="bg-accent rounded-lg p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="qt-text-small">Total Plugins</p>
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            </div>
            <div>
              <p className="qt-text-small">Enabled</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.enabled}</p>
            </div>
            <div>
              <p className="qt-text-small">Disabled</p>
              <p className="text-2xl font-bold text-muted-foreground">{stats.disabled}</p>
            </div>
            <div>
              <p className="qt-text-small">Errors</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.errors}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-border">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('installed')}
            className={`pb-2 px-1 text-sm font-medium transition-colors relative ${
              activeTab === 'installed'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Installed
            {activeTab === 'installed' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('browse')}
            className={`pb-2 px-1 text-sm font-medium transition-colors relative ${
              activeTab === 'browse'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Browse npm
            {activeTab === 'browse' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        </div>
      </div>

      {/* Installed Plugins Tab */}
      {activeTab === 'installed' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Plugin Management
            </h2>
            <p className="qt-text-small">
              Manage installed plugins and their status. Enable or disable plugins to control which
              features are available in <BrandName />.
            </p>
          </div>

          {plugins.length === 0 ? (
            <div className="bg-card rounded-lg border border-border p-8 text-center">
              <svg
                className="mx-auto h-12 w-12 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
              <h3 className="mt-4 text-lg qt-text-primary">
                No Plugins Found
              </h3>
              <p className="mt-2 qt-text-small">
                No plugins are currently installed. Browse npm to find and install plugins.
              </p>
              <button
                onClick={() => setActiveTab('browse')}
                className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                Browse Plugins
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {plugins.toSorted((a, b) => a.title.localeCompare(b.title)).map((plugin) => {
                const isToggling = toggling.has(plugin.name)
                const isUninstalling = actionInProgress === plugin.name
                return (
                  <div
                    key={plugin.name}
                    className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <h3 className="text-lg qt-text-primary">
                            {plugin.title}
                          </h3>
                          <span className="px-2 py-0.5 qt-text-label-xs bg-muted rounded">
                            v{plugin.version}
                          </span>
                          <span className={`px-2 py-0.5 qt-text-label-xs rounded ${getSourceBadge(plugin.source).className}`}>
                            {getSourceBadge(plugin.source).label}
                          </span>
                          {plugin.enabled ? (
                            <span className="px-2 py-0.5 qt-text-label-xs rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                              Enabled
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 qt-text-label-xs rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                              Disabled
                            </span>
                          )}
                        </div>
                        <p className="qt-text-small mb-2 text-muted-foreground">
                          {plugin.name}
                        </p>
                        {plugin.capabilities.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {plugin.capabilities.map((cap) => (
                              <span
                                key={cap}
                                className="px-2 py-0.5 qt-text-label-xs rounded bg-accent text-accent-foreground"
                              >
                                {cap}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        {/* Uninstall Button (for non-bundled plugins) */}
                        {canUninstall(plugin.source) && (
                          <button
                            onClick={() => uninstallPlugin(plugin.name, plugin.source)}
                            disabled={isUninstalling}
                            className="px-3 py-1 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
                          >
                            {isUninstalling ? 'Removing...' : 'Uninstall'}
                          </button>
                        )}

                        {/* Toggle Button */}
                        <button
                          onClick={() => handleTogglePlugin(plugin.name, plugin.enabled)}
                          disabled={isToggling}
                          className={`
                            relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                            transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring
                            focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed
                            ${plugin.enabled ? 'bg-primary' : 'bg-muted'}
                          `}
                          role="switch"
                          aria-checked={plugin.enabled}
                        >
                          <span
                            className={`
                              pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0
                              transition duration-200 ease-in-out
                              ${plugin.enabled ? 'translate-x-5' : 'translate-x-0'}
                            `}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Browse npm Tab */}
      {activeTab === 'browse' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Browse npm Plugins
            </h2>
            <p className="qt-text-small">
              Search and install plugins from the npm registry. All <BrandName /> plugins
              start with &quot;qtap-plugin-&quot;.
            </p>
          </div>

          {/* Search Bar */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchNpmPlugins()}
                placeholder="Search plugins (e.g., 'llm', 'theme', 'openai')..."
                className="w-full px-4 py-2 border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              onClick={searchNpmPlugins}
              disabled={searching}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {searching ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-r-transparent" />
                  Searching...
                </>
              ) : (
                'Search'
              )}
            </button>
          </div>

          {/* Quick Search Hint */}
          <p className="qt-text-small text-muted-foreground">
            Leave empty and click Search to see all available plugins.
          </p>

          {/* Search Results */}
          <div className="space-y-3">
            {searchResults.length === 0 && !searching && (
              <div className="bg-card rounded-lg border border-border p-8 text-center">
                <svg
                  className="mx-auto h-12 w-12 text-muted-foreground"
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
                <h3 className="mt-4 text-lg qt-text-primary">
                  Search for Plugins
                </h3>
                <p className="mt-2 qt-text-small">
                  Enter a search term or click Search to browse available plugins.
                </p>
              </div>
            )}

            {searchResults.map((plugin) => {
              const installed = isPluginInstalled(plugin.name)
              const isInstalling = actionInProgress === plugin.name

              return (
                <div
                  key={plugin.name}
                  className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-lg font-medium text-foreground">
                          {plugin.name}
                        </h3>
                        <span className="px-2 py-0.5 qt-text-label-xs bg-muted rounded">
                          v{plugin.version}
                        </span>
                        {installed && (
                          <span className="px-2 py-0.5 qt-text-label-xs rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                            Installed
                          </span>
                        )}
                      </div>
                      <p className="qt-text-small text-muted-foreground mb-2">
                        {plugin.description || 'No description available'}
                      </p>
                      <div className="flex items-center gap-4 qt-text-small text-muted-foreground">
                        {plugin.author && (
                          <span>by {plugin.author}</span>
                        )}
                        {plugin.updated && (
                          <span>
                            Updated {new Date(plugin.updated).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {plugin.keywords && plugin.keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {plugin.keywords.slice(0, 5).map((keyword) => (
                            <span
                              key={keyword}
                              className="px-2 py-0.5 qt-text-label-xs rounded bg-accent text-accent-foreground"
                            >
                              {keyword}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {installed ? (
                        <span className="px-4 py-2 text-sm text-muted-foreground bg-muted rounded-md">
                          Installed
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => installPlugin(plugin.name, 'user')}
                            disabled={isInstalling}
                            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                          >
                            {isInstalling ? 'Installing...' : 'Install'}
                          </button>
                          <button
                            onClick={() => installPlugin(plugin.name, 'site')}
                            disabled={isInstalling}
                            className="px-4 py-2 text-sm border border-border text-foreground rounded-md hover:bg-accent disabled:opacity-50 transition-colors"
                            title="Install for all users"
                          >
                            Install Site-wide
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Refresh Note */}
      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h4 className="qt-text-label text-amber-900 dark:text-amber-200">
              Note about plugin changes
            </h4>
            <p className="qt-text-small text-amber-700 dark:text-amber-300 mt-1">
              Newly installed plugins require an application restart to activate.
              Enabling or disabling existing plugins takes effect immediately,
              but some features may require a page refresh.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
