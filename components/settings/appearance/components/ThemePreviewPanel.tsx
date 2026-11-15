/**
 * Theme Preview Panel Component
 *
 * Renders a sample of the app's elements dressed in one theme, isolated from
 * the rest of the page.
 *
 * @module components/settings/appearance/components/ThemePreviewPanel
 */

'use client'

import { useMemo } from 'react'
import { ThemePreviewElements } from './ThemePreviewElements'

export interface ThemePreviewPanelProps {
  /** The theme's CSS as the server compiled it (already scoped to the theme id); empty for the default */
  compiledCss: string
  /** Theme ID: the preview container carries data-theme="<id>" */
  themeId: string
  /** Color mode to preview */
  mode: 'light' | 'dark'
  /** The theme's choices (density, …), set on the container as data-qt-<name> */
  choices?: Record<string, string>
  /** Optional label to display above the preview */
  label?: string
}

/**
 * A theme's CSS is already scoped to `[data-theme="<id>"]`, so the container
 * itself carries `data-theme`, the mode class and the theme's choices: the
 * generated registry defaults (re-declared on every `[data-theme]` element)
 * and the theme's own rules both apply inside it, and nothing outside it is
 * touched. The worn theme's descendant rules stop at the container
 * (lib/themes/engine/boundary.ts). The default theme injects nothing and
 * shows the defaults alone.
 */
export function ThemePreviewPanel({ compiledCss, themeId, mode, choices, label }: ThemePreviewPanelProps) {
  const choiceAttributes = useMemo(
    () => Object.fromEntries(Object.entries(choices ?? {}).map(([name, option]) => [`data-qt-${name}`, option])),
    [choices]
  )

  return (
    <div className="flex-1 min-w-0">
      {label && (
        <div className="text-center mb-2">
          <span className="qt-text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
      )}

      {compiledCss && <style dangerouslySetInnerHTML={{ __html: compiledCss }} />}

      <div
        data-theme={themeId}
        {...choiceAttributes}
        className={`${mode} qt-theme-preview-surface rounded-lg border qt-border-default overflow-hidden`}
        style={{ height: 'auto', minHeight: 'auto', maxHeight: 'none' }}
      >
        <ThemePreviewElements />
      </div>
    </div>
  )
}
