'use client'

import { useState, useEffect, useCallback, ReactNode } from 'react'
import { showErrorToast, showSuccessToast, showWarningToast } from '@/lib/toast'
import { BrandName } from '@/components/ui/brand-name'
import { PluginConfigModal } from './plugins/PluginConfigModal'
import { UpgradeConfirmModal, type PluginUpgrade } from './plugins/UpgradeConfirmModal'
import { SettingsCard, SettingsCardBadge } from '@/components/ui/SettingsCard'

type PluginSource = 'included' | 'npm' | 'git' | 'manual' | 'bundled' | 'site'
type ActiveTab = 'installed' | 'upgrades' | 'browse'

interface DeploymentInfo {
  isUserManaged: boolean
  isHosted: boolean
}

interface Plugin {
  name: string
  title: string
  version: string
  enabled: boolean
  capabilities: string[]
  path: string
  source: PluginSource
  packageName?: string
  hasConfigSchema?: boolean
}

interface InstalledPlugin {
  name: string
  title: string
  version: string
  description?: string
  author?: { name: string; email?: string; url?: string }
  source: 'bundled' | 'site'
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

const getSourceBadge = (source: PluginSource): SettingsCardBadge => {
  switch (source) {
    case 'included':
    case 'bundled':
      return { text: 'Bundled', variant: 'info' }
    case 'npm':
      return { text: 'NPM', variant: 'warning' }
    case 'site':
      return { text: 'Installed', variant: 'success' }
    case 'git':
      return { text: 'Git', variant: 'warning' }
    case 'manual':
      return { text: 'Manual', variant: 'muted' }
    default:
      return { text: 'Unknown', variant: 'muted' }
  }
}

/**
 * Toggle switch component for plugin enable/disable
 */
function PluginToggle({
  enabled,
  isToggling,
  onToggle,
}: {
  enabled: boolean
  isToggling: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      disabled={isToggling}
      className={`
        relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring
        focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed
        ${enabled ? 'bg-primary' : 'qt-bg-muted'}
      `}
      role="switch"
      aria-checked={enabled}
    >
      <span
        className={`
          pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0
          transition duration-200 ease-in-out
          ${enabled ? 'translate-x-5' : 'translate-x-0'}
        `}
      />
    </button>
  )
}

/**
 * Settings icon button for plugins with config schema
 */
function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="qt-button-ghost qt-button-sm flex items-center gap-1"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
      Settings
    </button>
  )
}

/**
 * Capability badges display
 */
function CapabilityBadges({ capabilities }: { capabilities: string[] }) {
  if (capabilities.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {capabilities.map((cap) => (
        <span key={cap} className="qt-badge-capability">
          {cap}
        </span>
      ))}
    </div>
  )
}

/**
 * Keyword badges display for npm plugins
 */
function KeywordBadges({ keywords }: { keywords?: string[] }) {
  if (!keywords || keywords.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {keywords.slice(0, 5).map((keyword) => (
        <span key={keyword} className="qt-badge-secondary">
          {keyword}
        </span>
      ))}
    </div>
  )
}

export default function PluginsTab() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('installed')
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([])
  const [stats, setStats] = useState<PluginStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<Set<string>>(new Set())
  const [deploymentInfo, setDeploymentInfo] = useState<DeploymentInfo | null>(null)

  // Browse state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NpmPlugin[]>([])
  const [searching, setSearching] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  // Config modal state
  const [configModalPlugin, setConfigModalPlugin] = useState<{ name: string; title: string } | null>(null)

  // Upgrades state
  const [availableUpgrades, setAvailableUpgrades] = useState<PluginUpgrade[]>([])
  const [upgradesLoading, setUpgradesLoading] = useState(false)
  const [upgradesLastChecked, setUpgradesLastChecked] = useState<string | null>(null)
  const [upgradeInProgress, setUpgradeInProgress] = useState<string | null>(null)
  const [confirmingUpgrade, setConfirmingUpgrade] = useState<PluginUpgrade | null>(null)

  const fetchPlugins = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/plugins')
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
      const res = await fetch('/api/v1/plugins?filter=installed')
      if (!res.ok) throw new Error('Failed to fetch installed plugins')
      const data = await res.json()
      setInstalledPlugins(data.plugins || [])
    } catch (err) {
      // Silently fail for installed plugins list, use main plugins list as fallback
    }
  }, [])

  const fetchDeploymentInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/deployment')
      if (!res.ok) throw new Error('Failed to fetch deployment info')
      const data: DeploymentInfo = await res.json()
      setDeploymentInfo(data)
    } catch (err) {
      // Silently fail, assume user-managed by default
      setDeploymentInfo({ isUserManaged: true, isHosted: false })
    }
  }, [])

  const fetchAvailableUpgrades = useCallback(async () => {
    setUpgradesLoading(true)
    try {
      const res = await fetch('/api/v1/plugins?action=check-upgrades')
      if (!res.ok) throw new Error('Failed to check for upgrades')
      const data = await res.json()
      setAvailableUpgrades(data.upgrades || [])
      setUpgradesLastChecked(data.lastChecked || new Date().toISOString())
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to check for upgrades')
    } finally {
      setUpgradesLoading(false)
    }
  }, [])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      await Promise.all([fetchPlugins(), fetchInstalledPlugins(), fetchDeploymentInfo()])
      setLoading(false)
      // Fetch upgrades in background after initial load
      fetchAvailableUpgrades()
    }
    loadData()
  }, [fetchPlugins, fetchInstalledPlugins, fetchDeploymentInfo, fetchAvailableUpgrades])

  const handleTogglePlugin = async (pluginName: string, currentEnabled: boolean) => {
    setToggling(prev => new Set(prev).add(pluginName))
    try {
      const res = await fetch(`/api/v1/plugins/${encodeURIComponent(pluginName)}`, {
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
      const res = await fetch('/api/v1/plugins?action=search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery.trim() || 'quilltap',
          type: 'all',
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Search failed')
      }

      const data = await res.json()
      setSearchResults(data.results || [])
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to search plugins')
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const installPlugin = async (packageName: string) => {
    setActionInProgress(packageName)
    try {
      const res = await fetch('/api/v1/plugins?action=install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName }),
      })

      const data = await res.json()

      if (!res.ok) {
        // Check if the error is due to restart requirement on hosted deployment
        if (data.requiresRestart && data.suggestedScope === 'site') {
          showWarningToast(data.error || 'This plugin requires site-wide installation on hosted deployments.')
        } else {
          showErrorToast(data.error || 'Installation failed')
        }
        return
      }

      // Check if server is restarting after installation
      if (data.serverRestarting) {
        showSuccessToast(data.message || 'Plugin installed! Server is restarting...')
        // The page will need to be refreshed after server comes back
        showWarningToast('Please wait for the server to restart and refresh this page.')
      } else {
        showSuccessToast(data.message || 'Plugin installed successfully!')
      }

      // Refresh installed plugins list and switch to installed tab
      await fetchInstalledPlugins()
      await fetchPlugins()
      setActiveTab('installed')

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

    setActionInProgress(packageName)
    try {
      const res = await fetch('/api/v1/plugins?action=uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Uninstall failed')
      }

      showSuccessToast(data.message || 'Plugin uninstalled successfully!')

      // Optimistically remove from local state for immediate UI update
      setPlugins(prev => prev.filter(p => p.name !== packageName && p.packageName !== packageName))
      setInstalledPlugins(prev => prev.filter(p => p.name !== packageName))

      // Update stats
      if (stats) {
        setStats(prev => prev ? {
          ...prev,
          total: prev.total - 1,
          enabled: prev.enabled - 1, // Assume it was enabled
        } : null)
      }

      // Refresh from server to ensure consistency
      await fetchInstalledPlugins()
      await fetchPlugins()

    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Uninstall failed')
    } finally {
      setActionInProgress(null)
    }
  }

  const upgradePlugin = async (upgrade: PluginUpgrade) => {
    setUpgradeInProgress(upgrade.packageName)
    try {
      const res = await fetch('/api/v1/plugins?action=install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: upgrade.packageName }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Upgrade failed')
      }

      showSuccessToast(`${upgrade.pluginTitle} upgraded to v${upgrade.latestVersion}`)

      // Remove from available upgrades list
      setAvailableUpgrades(prev => prev.filter(u => u.packageName !== upgrade.packageName))

      // Refresh plugins list
      await fetchPlugins()
      await fetchInstalledPlugins()

      // Close confirmation modal if open
      setConfirmingUpgrade(null)

    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Upgrade failed')
    } finally {
      setUpgradeInProgress(null)
    }
  }

  const handleUpgradeClick = (upgrade: PluginUpgrade) => {
    if (upgrade.isNonBreaking) {
      // Non-breaking: upgrade directly
      upgradePlugin(upgrade)
    } else {
      // Breaking: show confirmation modal
      setConfirmingUpgrade(upgrade)
    }
  }

  const isPluginInstalled = (packageName: string): boolean => {
    return installedPlugins.some(p => p.name === packageName) ||
           plugins.some(p => p.name === packageName)
  }

  const canUninstall = (source: string): boolean => {
    return source === 'site' || source === 'npm'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 qt-border-primary border-r-transparent"></div>
          <p className="qt-text-secondary">Loading plugins...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Header */}
      {stats && (
        <div className="qt-card p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <p className="qt-text-label">Total Plugins</p>
              <p className="text-2xl font-bold text-primary">{stats.total}</p>
            </div>
            <div>
              <p className="qt-text-label">Enabled</p>
              <p className="text-2xl font-bold qt-text-success">{stats.enabled}</p>
            </div>
            <div>
              <p className="qt-text-label">Upgrades</p>
              <p className={`text-2xl font-bold ${availableUpgrades.length > 0 ? 'qt-text-warning' : 'qt-text-secondary'}`}>
                {availableUpgrades.length}
              </p>
            </div>
            <div>
              <p className="qt-text-label">Disabled</p>
              <p className="text-2xl font-bold qt-text-secondary">{stats.disabled}</p>
            </div>
            <div>
              <p className="qt-text-label">Errors</p>
              <p className={`text-2xl font-bold ${stats.errors > 0 ? 'qt-text-destructive' : 'qt-text-secondary'}`}>
                {stats.errors}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b qt-border-default">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('installed')}
            className={`pb-2 px-1 text-sm font-medium transition-colors relative ${
              activeTab === 'installed'
                ? 'text-foreground'
                : 'qt-text-secondary hover:text-foreground'
            }`}
          >
            Installed
            {activeTab === 'installed' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('upgrades')}
            className={`pb-2 px-1 text-sm font-medium transition-colors relative ${
              activeTab === 'upgrades'
                ? 'text-foreground'
                : 'qt-text-secondary hover:text-foreground'
            }`}
          >
            Upgrades{availableUpgrades.length > 0 && ` (${availableUpgrades.length})`}
            {activeTab === 'upgrades' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('browse')}
            className={`pb-2 px-1 text-sm font-medium transition-colors relative ${
              activeTab === 'browse'
                ? 'text-foreground'
                : 'qt-text-secondary hover:text-foreground'
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
            <div className="qt-card p-8 text-center">
              <svg
                className="mx-auto h-12 w-12 qt-text-secondary/50"
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
              <h3 className="mt-4 text-lg text-primary">
                No Plugins Found
              </h3>
              <p className="mt-2 qt-text-small">
                No plugins are currently installed. Browse npm to find and install plugins.
              </p>
              <button
                onClick={() => setActiveTab('browse')}
                className="mt-4 qt-button-primary"
              >
                Browse Plugins
              </button>
            </div>
          ) : (
            <div className="qt-card-grid-auto">
              {plugins.toSorted((a, b) => a.title.localeCompare(b.title)).map((plugin) => {
                const isToggling = toggling.has(plugin.name)
                const isUninstalling = actionInProgress === plugin.name

                // Build badges array
                const badges: SettingsCardBadge[] = [
                  { text: `v${plugin.version}`, variant: 'muted' },
                  getSourceBadge(plugin.source),
                  plugin.enabled
                    ? { text: 'Enabled', variant: 'success' }
                    : { text: 'Disabled', variant: 'muted' },
                ]

                return (
                  <SettingsCard
                    key={plugin.name}
                    title={plugin.title}
                    subtitle={plugin.name}
                    badges={badges}
                    headerExtra={
                      <PluginToggle
                        enabled={plugin.enabled}
                        isToggling={isToggling}
                        onToggle={() => handleTogglePlugin(plugin.name, plugin.enabled)}
                      />
                    }
                  >
                    {/* Plugin actions */}
                    <div className="flex items-center gap-2 mt-2">
                      {plugin.hasConfigSchema && (
                        <SettingsButton
                          onClick={() => setConfigModalPlugin({ name: plugin.name, title: plugin.title })}
                        />
                      )}
                      {canUninstall(plugin.source) && (
                        <button
                          onClick={() => uninstallPlugin(plugin.packageName || plugin.name, plugin.source)}
                          disabled={isUninstalling}
                          className="qt-button-destructive qt-button-sm"
                        >
                          {isUninstalling ? 'Removing...' : 'Uninstall'}
                        </button>
                      )}
                    </div>

                    {/* Capability badges */}
                    <CapabilityBadges capabilities={plugin.capabilities} />
                  </SettingsCard>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Upgrades Tab */}
      {activeTab === 'upgrades' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Available Upgrades
              </h2>
              <p className="qt-text-small">
                Review and upgrade plugins that have newer versions available. Breaking changes
                require manual confirmation before upgrading.
              </p>
            </div>
            <button
              onClick={fetchAvailableUpgrades}
              disabled={upgradesLoading}
              className="qt-button-secondary flex items-center gap-2 flex-shrink-0"
            >
              {upgradesLoading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                  Checking...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Check for Updates
                </>
              )}
            </button>
          </div>

          {/* Last checked timestamp */}
          {upgradesLastChecked && (
            <p className="qt-text-small qt-text-secondary">
              Last checked: {new Date(upgradesLastChecked).toLocaleString()}
            </p>
          )}

          {/* Breaking changes warning banner */}
          {availableUpgrades.some(u => !u.isNonBreaking) && (
            <div className="qt-alert-warning flex items-start gap-3">
              <svg
                className="w-5 h-5 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <h4 className="qt-text-label">
                  Breaking Changes Available
                </h4>
                <p className="qt-text-small mt-1">
                  Some upgrades include major version changes that may contain breaking changes.
                  Review the changelog before upgrading these plugins.
                </p>
              </div>
            </div>
          )}

          {upgradesLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 qt-border-primary border-r-transparent"></div>
                <p className="qt-text-secondary">Checking for updates...</p>
              </div>
            </div>
          ) : availableUpgrades.length === 0 ? (
            <div className="qt-card p-8 text-center">
              <svg
                className="mx-auto h-12 w-12 qt-text-success"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h3 className="mt-4 text-lg text-primary">
                All Plugins Up to Date
              </h3>
              <p className="mt-2 qt-text-small">
                All installed plugins are running the latest version.
              </p>
            </div>
          ) : (
            <div className="qt-card-grid-auto">
              {availableUpgrades.map((upgrade) => {
                const isUpgrading = upgradeInProgress === upgrade.packageName

                // Build badges array
                const badges: SettingsCardBadge[] = [
                  upgrade.isNonBreaking
                    ? { text: 'Update', variant: 'success' }
                    : { text: 'Breaking', variant: 'warning' },
                ]

                return (
                  <SettingsCard
                    key={upgrade.packageName}
                    title={upgrade.pluginTitle}
                    subtitle={upgrade.packageName}
                    badges={badges}
                    headerExtra={
                      <button
                        onClick={() => handleUpgradeClick(upgrade)}
                        disabled={isUpgrading || upgradeInProgress !== null}
                        className={`qt-button-sm ${upgrade.isNonBreaking ? 'qt-button-primary' : 'qt-button-warning'}`}
                      >
                        {isUpgrading ? 'Upgrading...' : 'Upgrade'}
                      </button>
                    }
                  >
                    {/* Version transition */}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="qt-badge-secondary font-mono text-xs">v{upgrade.currentVersion}</span>
                      <svg className="w-4 h-4 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                      <span className={`font-mono text-xs ${upgrade.isNonBreaking ? 'qt-badge-success' : 'qt-badge-warning'}`}>
                        v{upgrade.latestVersion}
                      </span>
                    </div>

                    {/* Description */}
                    {upgrade.pluginDescription && (
                      <p className="qt-text-small mt-2 line-clamp-2">{upgrade.pluginDescription}</p>
                    )}

                    {/* External links */}
                    <div className="flex items-center gap-3 mt-3 qt-text-small">
                      {upgrade.repository && (
                        <a
                          href={upgrade.repository}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="qt-text-secondary hover:text-foreground inline-flex items-center gap-1"
                        >
                          Repository
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                      {upgrade.changelogUrl && (
                        <a
                          href={upgrade.changelogUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="qt-text-secondary hover:text-foreground inline-flex items-center gap-1"
                        >
                          Changelog
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                      <a
                        href={upgrade.npmUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="qt-text-secondary hover:text-foreground inline-flex items-center gap-1"
                      >
                        npm
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </SettingsCard>
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
                className="qt-input"
              />
            </div>
            <button
              onClick={searchNpmPlugins}
              disabled={searching}
              className="qt-button-primary flex items-center gap-2"
            >
              {searching ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 qt-border-primary-foreground border-r-transparent" />
                  Searching...
                </>
              ) : (
                'Search'
              )}
            </button>
          </div>

          {/* Quick Search Hint */}
          <p className="qt-text-small qt-text-secondary">
            Leave empty and click Search to see all available plugins.
          </p>

          {/* Search Results */}
          <div className="qt-card-grid-auto">
            {searchResults.length === 0 && !searching && (
              <div className="qt-card p-8 text-center">
                <svg
                  className="mx-auto h-12 w-12 qt-text-secondary/50"
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
                <h3 className="mt-4 text-lg text-primary">
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

              // Build badges array
              const badges: SettingsCardBadge[] = [
                { text: `v${plugin.version}`, variant: 'muted' },
              ]
              if (installed) {
                badges.push({ text: 'Installed', variant: 'success' })
              }

              return (
                <SettingsCard
                  key={plugin.name}
                  title={plugin.name}
                  subtitle={plugin.description || 'No description available'}
                  badges={badges}
                  headerExtra={
                    installed ? (
                      <span className="qt-badge-secondary">Installed</span>
                    ) : (
                      <button
                        onClick={() => installPlugin(plugin.name)}
                        disabled={isInstalling}
                        className="qt-button-primary qt-button-sm"
                      >
                        {isInstalling ? 'Installing...' : 'Install'}
                      </button>
                    )
                  }
                >
                  {/* Author and update info */}
                  <div className="flex items-center gap-4 qt-text-small qt-text-secondary mt-1">
                    {plugin.author && <span>by {plugin.author}</span>}
                    {plugin.updated && (
                      <span>Updated {new Date(plugin.updated).toLocaleDateString()}</span>
                    )}
                  </div>

                  {/* Keyword badges */}
                  <KeywordBadges keywords={plugin.keywords} />
                </SettingsCard>
              )
            })}
          </div>
        </div>
      )}

      {/* Refresh Note */}
      <div className="qt-alert-warning">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 flex-shrink-0 mt-0.5"
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
            <h4 className="qt-text-label">
              Note about plugin changes
            </h4>
            <p className="qt-text-small mt-1">
              Newly installed plugins require an application restart to activate.
              Enabling or disabling existing plugins takes effect immediately,
              but some features may require a page refresh.
            </p>
            {deploymentInfo?.isHosted && (
              <p className="qt-text-small mt-2">
                <strong>Hosted deployment:</strong> Some plugins (such as authentication or database backends)
                require site-wide installation and will trigger an automatic server restart.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Plugin Configuration Modal */}
      {configModalPlugin && (
        <PluginConfigModal
          isOpen={true}
          onClose={() => setConfigModalPlugin(null)}
          pluginName={configModalPlugin.name}
          pluginTitle={configModalPlugin.title}
          onSuccess={() => {
            // Refresh plugins list to update any status changes
            fetchPlugins()
          }}
        />
      )}

      {/* Upgrade Confirmation Modal */}
      {confirmingUpgrade && (
        <UpgradeConfirmModal
          isOpen={true}
          onClose={() => setConfirmingUpgrade(null)}
          onConfirm={() => upgradePlugin(confirmingUpgrade)}
          upgrade={confirmingUpgrade}
          isUpgrading={upgradeInProgress === confirmingUpgrade.packageName}
        />
      )}
    </div>
  )
}
