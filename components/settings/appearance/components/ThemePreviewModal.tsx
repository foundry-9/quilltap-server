'use client'

/**
 * Theme Preview Modal
 *
 * Full-page modal preview for a theme. Shows a themed banner header (with an
 * accessible foreground computed from the theme's own background — "Option B"),
 * a live element preview with a Light/Dark toggle, a gallery of the theme's
 * manifest-referenced images, and a sheet of the theme's overridden icons
 * rendered in four states. Replaces the old inline expanded ThemeCard preview.
 *
 * @module components/settings/appearance/components/ThemePreviewModal
 */

import { useEffect, useMemo, useState, useId, type CSSProperties } from 'react'
import type { ThemeSummary } from '@/components/providers/theme-provider'
import type { ThemePreviewImage, ThemeTokens } from '@/lib/themes/types'
import { BaseModal } from '@/components/ui/BaseModal'
import { BrandName } from '@/components/ui/brand-name'
import { Icon, type IconName } from '@/components/ui/icon'
import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens'
import { generateScopedThemeCSS, generateIconOverridesCSS } from '@/lib/themes/utils'
import { useThemePreview } from '../hooks/useThemePreview'
import { ThemePreviewPanel } from './ThemePreviewPanel'
import { getContrastingTextColor, getMutedTextColor, getSourceBadge } from '../utils/contrast'

interface ThemePreviewModalProps {
  /** The theme to preview; null = the built-in default theme. */
  theme: ThemeSummary | null
  isActive: boolean
  isOpen: boolean
  onClose: () => void
  /** Apply (select) this theme. */
  onApply: () => void
  onUninstall?: () => void
  onExport?: () => void
}

/** Case-insensitive name comparator (display-name ordering). */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** Inline checkerboard backing so transparent images read clearly. */
const CHECKER_STYLE: CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%), ' +
    'linear-gradient(-45deg, rgba(128,128,128,0.18) 25%, transparent 25%), ' +
    'linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.18) 75%), ' +
    'linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.18) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
}

export function ThemePreviewModal({
  theme,
  isActive,
  isOpen,
  onClose,
  onApply,
  onUninstall,
  onExport,
}: ThemePreviewModalProps) {
  const isDefault = theme === null
  const themeId = isDefault ? 'default' : theme.id
  const name = isDefault ? 'Default' : theme.name
  const description = isDefault
    ? <>The default <BrandName /> theme with a clean, professional appearance.</>
    : theme.description
  const supportsDarkMode = isDefault ? true : theme.supportsDarkMode

  const { tokens, fonts, cssOverrides, icons, images, isLoading, error, fetchTokens } =
    useThemePreview(isDefault ? null : themeId)

  // Fetch tokens (and icons/images) when the modal opens for a real theme.
  useEffect(() => {
    if (isOpen && !isDefault) {
      fetchTokens()
    }
  }, [isOpen, isDefault, fetchTokens])

  // Light/Dark toggle (default light). The modal is keyed by theme in the parent,
  // so state resets to light each time a different theme's preview opens. A theme
  // without dark support is always shown light.
  const [mode, setMode] = useState<'light' | 'dark'>('light')
  const effectiveMode: 'light' | 'dark' = supportsDarkMode ? mode : 'light'

  const previewTokens = isDefault ? DEFAULT_THEME_TOKENS : tokens

  // Banner (Option B): theme-derived background → computed accessible foreground.
  const bannerBg = previewTokens?.colors?.[effectiveMode]?.background || '#1a1a1a'
  const fg = getContrastingTextColor(bannerBg)
  const muted = getMutedTextColor(bannerBg)
  const badge = isDefault
    ? { label: 'Built-in', deprecated: false }
    : getSourceBadge(theme?.source, theme?.deprecated)

  // Chips painted on the themed banner use the computed foreground so they stay legible.
  const chipStyle: CSSProperties = {
    backgroundColor: `${fg}15`,
    color: fg,
    borderColor: `${fg}33`,
  }

  // Defensive re-sort (registry already sorts images; icons arrive unsorted).
  const sortedImages = useMemo(() => [...images].sort(byName), [images])
  const sortedIcons = useMemo(() => [...icons].sort(byName), [icons])

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title={name} maxWidth="full" showCloseButton>
      <div className="space-y-6">
        {/* 4a. Themed banner header */}
        <div className="rounded-lg p-5" style={{ backgroundColor: bannerBg }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-2xl font-semibold" style={{ color: fg }}>
                {name}
              </div>
              {description && (
                <div className="mt-1 text-sm max-w-2xl" style={{ color: muted }}>
                  {description}
                </div>
              )}
              {badge && (
                <span
                  className="inline-flex items-center mt-2 px-2 py-0.5 rounded border qt-text-label-xs"
                  style={chipStyle}
                >
                  {badge.label}
                  {badge.deprecated && ' (deprecated)'}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Light/Dark toggle */}
              <div
                className="inline-flex rounded-md border overflow-hidden"
                style={{ borderColor: `${fg}33` }}
                role="group"
                aria-label="Preview color mode"
              >
                <button
                  type="button"
                  onClick={() => setMode('light')}
                  className="px-2.5 py-1 qt-text-label-xs inline-flex items-center gap-1"
                  style={{ backgroundColor: effectiveMode === 'light' ? `${fg}22` : 'transparent', color: fg }}
                  aria-pressed={effectiveMode === 'light'}
                >
                  <Icon name="sun" className="w-3.5 h-3.5" />
                  Light
                </button>
                {supportsDarkMode && (
                  <button
                    type="button"
                    onClick={() => setMode('dark')}
                    className="px-2.5 py-1 qt-text-label-xs inline-flex items-center gap-1"
                    style={{ backgroundColor: effectiveMode === 'dark' ? `${fg}22` : 'transparent', color: fg }}
                    aria-pressed={effectiveMode === 'dark'}
                  >
                    <Icon name="moon" className="w-3.5 h-3.5" />
                    Dark
                  </button>
                )}
              </div>

              {/* Export */}
              {onExport && (
                <button
                  type="button"
                  onClick={onExport}
                  className="px-2 py-1 rounded border qt-text-label-xs inline-flex items-center gap-1"
                  style={chipStyle}
                  title="Export as .qtap-theme"
                >
                  <Icon name="download" className="w-3.5 h-3.5" />
                  Export
                </button>
              )}

              {/* Uninstall (bundle themes only, never the active one) */}
              {onUninstall && !isActive && (
                <button
                  type="button"
                  onClick={onUninstall}
                  className="px-2 py-1 rounded border qt-text-label-xs inline-flex items-center gap-1"
                  style={chipStyle}
                  title="Uninstall theme"
                >
                  <Icon name="trash" className="w-3.5 h-3.5" />
                  Uninstall
                </button>
              )}

              {/* Apply / Active */}
              {isActive ? (
                <span
                  className="px-2.5 py-1 rounded border qt-text-label-xs inline-flex items-center gap-1"
                  style={chipStyle}
                >
                  <Icon name="check" className="w-3.5 h-3.5" />
                  Active
                </span>
              ) : (
                <button type="button" onClick={onApply} className="qt-button-primary qt-button-sm">
                  Apply
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 4b. Live element preview */}
        <section>
          {isLoading && !previewTokens && (
            <div className="flex items-center justify-center py-12">
              <div className="qt-spinner" />
              <span className="ml-2 qt-text-small">Loading theme preview...</span>
            </div>
          )}
          {error && !previewTokens && (
            <div className="qt-alert-error p-4 rounded-lg">
              <p className="font-medium">Failed to load theme preview</p>
              <p className="qt-text-small mt-1">{error}</p>
            </div>
          )}
          {previewTokens && (
            <ThemePreviewPanel
              tokens={previewTokens}
              themeId={themeId}
              mode={effectiveMode}
              fonts={fonts}
              cssOverrides={cssOverrides}
            />
          )}
        </section>

        {/* 4c. Image gallery */}
        <section>
          <h3 className="qt-heading-4 mb-3">Bundled Images</h3>
          {sortedImages.length === 0 ? (
            <p className="qt-text-small qt-text-secondary">This theme bundles no preview images.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {sortedImages.map((img) => (
                <GalleryCell key={img.src} image={img} />
              ))}
            </div>
          )}
        </section>

        {/* 4d. Icon sheet */}
        <section>
          <h3 className="qt-heading-4 mb-1">Overridden Icons</h3>
          {sortedIcons.length === 0 ? (
            <p className="qt-text-small qt-text-secondary">This theme overrides no icons.</p>
          ) : (
            <ThemeIconSheet
              icons={sortedIcons}
              tokens={previewTokens ?? DEFAULT_THEME_TOKENS}
              mode={effectiveMode}
            />
          )}
        </section>
      </div>
    </BaseModal>
  )
}

/** One gallery image cell. Hides itself if the asset fails to load. */
function GalleryCell({ image }: { image: ThemePreviewImage }) {
  const [broken, setBroken] = useState(false)
  if (broken) return null
  return (
    <div className="rounded-lg border qt-border-default overflow-hidden">
      <div className="aspect-video flex items-center justify-center" style={CHECKER_STYLE}>
        {/* Plain <img>: theme assets are runtime URLs Next/Image can't pre-size (see CLAUDE.md) */}
        <img
          src={image.src}
          alt={image.name}
          loading="lazy"
          onError={() => setBroken(true)}
          className="max-w-full max-h-full object-contain"
        />
      </div>
      <div className="p-2 flex items-center justify-between gap-2">
        <span className="qt-text-small truncate" title={image.name}>
          {image.name}
        </span>
        <span className="qt-badge-secondary shrink-0">{image.kind}</span>
      </div>
    </div>
  )
}

/**
 * Renders the theme's icon overrides inside a theme-scoped container so the
 * bundled override CSS (and theme color tokens) are in effect, each icon shown
 * in four synthetic states.
 */
function ThemeIconSheet({
  icons,
  tokens,
  mode,
}: {
  icons: { name: string; src: string }[]
  tokens: ThemeTokens
  mode: 'light' | 'dark'
}) {
  const instanceId = useId().replace(/:/g, '')
  const scopeClass = `theme-icon-sheet-${mode}-${instanceId}`

  // Scope the theme's color tokens AND its icon overrides to this container, so
  // <Icon> inside it resolves the override and the qt-* state classes resolve to
  // the theme's own colors. Icon-override rules are emitted unlayered, so they
  // beat the @layer components defaults by cascade origin.
  const scopedCSS = useMemo(() => {
    const tokenCSS = generateScopedThemeCSS(tokens, undefined, scopeClass, mode)
    const iconCSS = generateIconOverridesCSS(icons, `.${scopeClass}`)
    return `${tokenCSS}\n\n/* Icon overrides (scoped) */\n${iconCSS}`
  }, [tokens, icons, scopeClass, mode])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: scopedCSS }} />

      {/* Legend for the four state columns */}
      <div className="flex items-center gap-3 mb-3 qt-text-xs qt-text-secondary">
        <span className="font-medium">States:</span>
        <span>default</span>
        <span aria-hidden>·</span>
        <span>muted</span>
        <span aria-hidden>·</span>
        <span>hover</span>
        <span aria-hidden>·</span>
        <span>on-primary</span>
      </div>

      <div
        className={`${scopeClass} rounded-lg border qt-border-default p-4`}
        style={{ height: 'auto', minHeight: 'auto', maxHeight: 'none' }}
      >
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          {icons.map((icon) => {
            // Override names are validated to match a canonical app IconName.
            const iconName = icon.name as IconName
            return (
              <div
                key={icon.name}
                className="flex flex-col items-center gap-2 p-2 rounded-lg border qt-border-default"
              >
                <div className="flex items-center gap-2">
                  {/* default */}
                  <span className="qt-text-primary inline-flex">
                    <Icon name={iconName} className="w-6 h-6" />
                  </span>
                  {/* muted / disabled */}
                  <span className="qt-text-secondary opacity-50 inline-flex">
                    <Icon name={iconName} className="w-6 h-6" />
                  </span>
                  {/* hover / active */}
                  <span className="qt-text-primary qt-bg-muted rounded p-1 inline-flex">
                    <Icon name={iconName} className="w-6 h-6" />
                  </span>
                  {/* on-primary (icon inherits the primary button's foreground) */}
                  <span className="qt-button-primary rounded p-1 inline-flex">
                    <Icon name={iconName} className="w-6 h-6" />
                  </span>
                </div>
                <span className="font-mono qt-text-xs select-all break-all text-center">
                  {icon.name}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

export default ThemePreviewModal
