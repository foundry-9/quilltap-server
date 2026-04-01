/**
 * Debug Theme Info Component
 *
 * Development-only component displaying current theme state and CSS variable test.
 * Used for debugging theme system functionality.
 *
 * @module components/settings/appearance/components/DebugThemeInfo
 */

import type { ColorMode } from '@/lib/themes/types'

interface DebugThemeInfoProps {
  activeThemeId: string | null
  colorMode: ColorMode
  resolvedColorMode: 'light' | 'dark'
  themesCount: number
}

/**
 * Renders debug information for the theme system
 */
export function DebugThemeInfo({
  activeThemeId,
  colorMode,
  resolvedColorMode,
  themesCount,
}: DebugThemeInfoProps) {
  return (
    <section className="border-t border-border pt-8">
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Debug: Current Theme State
        </summary>
        <div className="mt-2 p-3 bg-muted rounded-lg font-mono qt-text-xs space-y-2">
          <div>Active Theme ID: {activeThemeId ?? 'default'}</div>
          <div>Color Mode: {colorMode}</div>
          <div>Resolved Mode: {resolvedColorMode}</div>
          <div>Available Themes: {themesCount}</div>

          {/* Visual test: These boxes use CSS variables directly */}
          <div className="mt-4 pt-4 border-t border-border">
            <div className="qt-text-xs font-semibold mb-2">
              CSS Variable Test (should change with theme):
            </div>
            <div className="flex gap-2">
              <div
                className="w-12 h-12 rounded border"
                style={{ backgroundColor: 'var(--theme-background)' }}
                title="--theme-background"
              />
              <div
                className="w-12 h-12 rounded border"
                style={{ backgroundColor: 'var(--theme-primary)' }}
                title="--theme-primary"
              />
              <div
                className="w-12 h-12 rounded border"
                style={{ backgroundColor: 'var(--theme-secondary)' }}
                title="--theme-secondary"
              />
              <div
                className="w-12 h-12 rounded border"
                style={{ backgroundColor: 'var(--theme-accent)' }}
                title="--theme-accent"
              />
            </div>
            <div className="qt-text-xs mt-1">
              bg / primary / secondary / accent
            </div>
          </div>
        </div>
      </details>
    </section>
  )
}
