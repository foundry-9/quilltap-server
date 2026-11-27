'use client'

/**
 * Theme Selector Component
 *
 * Displays available themes as selectable cards with previews.
 * Includes the default theme and the installed bundle themes, then lists any
 * theme that was found but refused (made for an earlier Quilltap, or declared
 * by a plugin). The Preview button on a card opens a single full-page
 * ThemePreviewModal. Supports installing .qtap-theme bundles via file upload
 * and uninstalling bundle themes, refused ones included.
 *
 * @module components/settings/appearance/ThemeSelector
 */

import { useState, useCallback, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ApiFetchError, apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { triggerDownload } from '@/lib/download-utils'
import { useTheme, type ThemeSummary } from '@/components/providers/theme-provider'
import { BrandName } from '@/components/ui/brand-name'
import { ThemeCard } from './components/ThemeCard'
import { ThemePreviewModal } from './components/ThemePreviewModal'
import { RefusedThemes } from './components/RefusedThemes'
import { Icon } from '@/components/ui/icon'
import { useRouter } from 'next/navigation'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'

interface ThemeSelectorProps {
  activeThemeId: string | null
  availableThemes: ThemeSummary[]
  onThemeSelect: (themeId: string | null) => void
  onRefreshThemes?: () => Promise<void>
}

/**
 * Renders the theme selector section with theme cards
 */
export function ThemeSelector({
  activeThemeId,
  availableThemes,
  onThemeSelect,
  onRefreshThemes,
}: ThemeSelectorProps) {
  // Track which theme has its preview modal open (null = closed, 'default' = default theme)
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null)
  const [installStatus, setInstallStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { refusedThemes } = useTheme()
  const workspace = useWorkspaceOptional()
  const router = useRouter()

  const installMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append('theme', file)
      return apiFetch<{ themeId?: string }>('/api/v1/themes?action=install', {
        method: 'POST',
        body: formData,
      })
    },
  })
  const { mutateAsync: installAsync } = installMutation
  const uninstallMutation = useMutation({
    mutationFn: (themeId: string) =>
      apiFetch<{ message?: string }>(`/api/v1/themes/${themeId}`, { method: 'DELETE' }),
  })
  const { mutateAsync: uninstallAsync } = uninstallMutation

  /** Open Calliope's Atelier — a tab inside the workspace, a route outside. */
  const openAtelier = () => {
    if (workspace) workspace.openTab('theme-editor')
    else router.push('/calliope')
  }

  // Open the full-page preview modal for a theme (null = the default theme)
  const handleOpenPreview = useCallback((themeId: string | null) => {
    setPreviewThemeId(themeId ?? 'default')
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
      const result = await installAsync(file)
      setInstallStatus({
        message: `Theme "${result.themeId}" installed successfully`,
        type: 'success',
      })
      // Refresh themes list
      await onRefreshThemes?.()
    } catch (err) {
      setInstallStatus({
        // The server's refusal speaks for itself; a dropped upload says so.
        message: err instanceof ApiFetchError ? apiErrorMessage(err, 'Installation failed') : 'Failed to upload theme file',
        type: 'error',
      })
    } finally {
      setIsInstalling(false)
      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [installAsync, onRefreshThemes])

  // Handle uninstall
  const handleUninstall = useCallback(async (themeId: string) => {
    try {
      const result = await uninstallAsync(themeId)
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
    } catch (err) {
      setInstallStatus({
        message: err instanceof ApiFetchError ? apiErrorMessage(err, 'Uninstall failed') : 'Failed to uninstall theme',
        type: 'error',
      })
    }
  }, [uninstallAsync, activeThemeId, onThemeSelect, onRefreshThemes])

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

      await triggerDownload(await response.blob(), `${themeId}.qtap-theme`)
    } catch {
      setInstallStatus({
        message: 'Failed to export theme',
        type: 'error',
      })
    }
  }, [])

  // Resolve the theme being previewed in the modal (null = default theme).
  const previewTheme =
    previewThemeId && previewThemeId !== 'default'
      ? availableThemes.find((t) => t.id === previewThemeId) ?? null
      : null
  const previewIsActive =
    previewThemeId === 'default' ? activeThemeId === null : activeThemeId === previewThemeId

  return (
    <section className="border-t qt-border-default pt-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="qt-heading-3 qt-text">Theme</h2>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openAtelier}
          className="qt-button-secondary qt-button-sm flex items-center gap-1.5"
        >
          <Icon name="themes" className="w-4 h-4" />
          Design a theme
        </button>
        <button
          type="button"
          onClick={handleInstallClick}
          disabled={isInstalling}
          className="qt-button-secondary qt-button-sm flex items-center gap-1.5"
        >
          {isInstalling ? (
            <>
              <div className="qt-spinner w-3 h-3" />
              Installing...
            </>
          ) : (
            <>
              <Icon name="plus" className="w-4 h-4" />
              Install Theme
            </>
          )}
        </button>
        </div>
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
            Upload .qtap-theme bundles, or browse a registry below, to see more options here.
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
              aria-label="Dismiss message"
              type="button"
              onClick={() => setInstallStatus(null)}
              className="ml-2 text-current opacity-60 hover:opacity-100"
            >
              <Icon name="close" className="w-4 h-4" />
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
          onToggleExpand={() => handleOpenPreview(null)}
        />

        {/* Bundle Theme Cards */}
        {availableThemes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            isActive={activeThemeId === theme.id}
            onSelect={() => onThemeSelect(theme.id)}
            onToggleExpand={() => handleOpenPreview(theme.id)}
          />
        ))}
      </div>

      <RefusedThemes refused={refusedThemes} onUninstall={handleUninstall} />

      {/* Hint about adding themes */}
      {availableThemes.length === 0 && (
        <div className="mt-4 border qt-border-default rounded-lg p-4 qt-bg-muted">
          <div className="flex items-start gap-3">
            <Icon name="info" className="w-5 h-5 qt-text-secondary flex-shrink-0 mt-0.5" />
            <div>
              <p className="qt-text-small">
                Additional themes can be added by uploading{' '}
                <code className="qt-code-inline">.qtap-theme</code> bundle files, or from a theme registry below.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Single full-page preview modal, driven by previewThemeId.
          Keyed by theme so its local state (color mode) resets on each open. */}
      <ThemePreviewModal
        key={previewThemeId ?? 'closed'}
        theme={previewTheme}
        isActive={previewIsActive}
        isOpen={previewThemeId !== null}
        onClose={() => setPreviewThemeId(null)}
        onApply={() => onThemeSelect(previewThemeId === 'default' ? null : previewThemeId)}
        onUninstall={
          previewTheme?.source === 'bundle' ? () => handleUninstall(previewTheme.id) : undefined
        }
        onExport={() => handleExport(previewThemeId === 'default' ? 'default' : previewThemeId ?? '')}
      />
    </section>
  )
}
