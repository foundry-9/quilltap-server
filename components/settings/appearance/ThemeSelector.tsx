'use client'

/**
 * Theme Selector Component
 *
 * Displays available themes as selectable cards with previews.
 * Includes default theme, plugin-provided themes, and bundle themes.
 * Supports expandable rich previews with only one expanded at a time.
 * Supports installing .qtap-theme bundles via file upload and uninstalling bundle themes.
 *
 * @module components/settings/appearance/ThemeSelector
 */

import { useState, useCallback, useRef } from 'react'
import type { ThemeSummary } from '@/components/providers/theme-provider'
import { BrandName } from '@/components/ui/brand-name'
import { ThemeCard } from './components/ThemeCard'

interface ThemeSelectorProps {
  activeThemeId: string | null
  availableThemes: ThemeSummary[]
  isLoading?: boolean
  onThemeSelect: (themeId: string | null) => void
  onRefreshThemes?: () => Promise<void>
}

/**
 * Renders the theme selector section with theme cards
 */
export function ThemeSelector({
  activeThemeId,
  availableThemes,
  isLoading = false,
  onThemeSelect,
  onRefreshThemes,
}: ThemeSelectorProps) {
  // Track which theme has its preview expanded (null = none, 'default' = default theme)
  const [expandedThemeId, setExpandedThemeId] = useState<string | null>(null)
  const [installStatus, setInstallStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Handle toggle expand - only one can be expanded at a time
  const handleToggleExpand = useCallback((themeId: string | null) => {
    setExpandedThemeId((current) => {
      const key = themeId ?? 'default'
      if (current === key) {
        return null
      }
      return key
    })
  }, [])

  // Handle .qtap-theme file upload
  const handleInstallClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsInstalling(true)
    setInstallStatus(null)

    try {
      const formData = new FormData()
      formData.append('theme', file)

      const response = await fetch('/api/v1/themes?action=install', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (response.ok) {
        setInstallStatus({
          message: `Theme "${result.themeId}" installed successfully`,
          type: 'success',
        })
        // Refresh themes list
        await onRefreshThemes?.()
      } else {
        setInstallStatus({
          message: result.error || 'Installation failed',
          type: 'error',
        })
      }
    } catch (err) {
      setInstallStatus({
        message: 'Failed to upload theme file',
        type: 'error',
      })
    } finally {
      setIsInstalling(false)
      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [onRefreshThemes])

  // Handle uninstall
  const handleUninstall = useCallback(async (themeId: string) => {
    try {
      const response = await fetch(`/api/v1/themes/${themeId}`, {
        method: 'DELETE',
      })

      const result = await response.json()

      if (response.ok) {
        setInstallStatus({
          message: result.message || `Theme uninstalled successfully`,
          type: 'success',
        })
        // If the uninstalled theme was active, switch to default
        if (activeThemeId === themeId) {
          onThemeSelect(null)
        }
        // Refresh themes list
        await onRefreshThemes?.()
      } else {
        setInstallStatus({
          message: result.error || 'Uninstall failed',
          type: 'error',
        })
      }
    } catch {
      setInstallStatus({
        message: 'Failed to uninstall theme',
        type: 'error',
      })
    }
  }, [activeThemeId, onThemeSelect, onRefreshThemes])

  // Handle export
  const handleExport = useCallback(async (themeId: string) => {
    try {
      const response = await fetch(`/api/v1/themes/${themeId}?action=export`)
      if (!response.ok) {
        const result = await response.json()
        setInstallStatus({
          message: result.error || 'Export failed',
          type: 'error',
        })
        return
      }

      // Download the file
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${themeId}.qtap-theme`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setInstallStatus({
        message: 'Failed to export theme',
        type: 'error',
      })
    }
  }, [])

  return (
    <section className="border-t qt-border-default pt-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-semibold text-foreground">Theme</h2>
        <button
          type="button"
          onClick={handleInstallClick}
          disabled={isInstalling || isLoading}
          className="qt-button-secondary qt-button-sm flex items-center gap-1.5"
        >
          {isInstalling ? (
            <>
              <div className="qt-spinner w-3 h-3" />
              Installing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Install Theme
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".qtap-theme,.zip"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      <p className="qt-text-secondary mb-4">
        Select a theme to customize the colors and appearance of <BrandName />.
        {availableThemes.length === 0 && (
          <span className="block mt-1 qt-text-small">
            Install theme plugins or upload .qtap-theme bundles to see more options here.
          </span>
        )}
      </p>

      {/* Install status message */}
      {installStatus && (
        <div
          className={`qt-alert mb-4 text-sm ${
            installStatus.type === 'success' ? 'qt-alert-success' : 'qt-alert-error'
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{installStatus.message}</span>
            <button
              type="button"
              onClick={() => setInstallStatus(null)}
              className="ml-2 text-current opacity-60 hover:opacity-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Default Theme Card */}
        <ThemeCard
          theme={null}
          isActive={activeThemeId === null}
          onSelect={() => onThemeSelect(null)}
          disabled={isLoading}
          isExpanded={expandedThemeId === 'default'}
          onToggleExpand={() => handleToggleExpand(null)}
          onExport={() => handleExport('default')}
        />

        {/* Plugin and Bundle Theme Cards */}
        {availableThemes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            isActive={activeThemeId === theme.id}
            onSelect={() => onThemeSelect(theme.id)}
            disabled={isLoading}
            isExpanded={expandedThemeId === theme.id}
            onToggleExpand={() => handleToggleExpand(theme.id)}
            onUninstall={theme.source === 'bundle' ? () => handleUninstall(theme.id) : undefined}
            onExport={() => handleExport(theme.id)}
          />
        ))}
      </div>

      {/* Hint about theme plugins */}
      {availableThemes.length === 0 && (
        <div className="mt-4 p-4 bg-accent rounded-lg border qt-border-default">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 qt-text-secondary flex-shrink-0 mt-0.5"
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
              <p className="qt-text-small">
                Additional themes can be added by installing theme plugins from the{' '}
                <span className="font-medium">Plugins</span> tab, or by uploading{' '}
                <code className="qt-code">.qtap-theme</code> bundle files.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
