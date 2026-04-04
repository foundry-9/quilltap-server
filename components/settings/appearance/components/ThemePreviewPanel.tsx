/**
 * Theme Preview Panel Component
 *
 * Isolated container for rendering a theme preview with scoped CSS.
 * Applies theme tokens as CSS variables within a scoped container,
 * ensuring the preview is isolated from the rest of the page.
 *
 * @module components/settings/appearance/components/ThemePreviewPanel
 */

'use client'

import { useMemo, useId } from 'react'
import type { ThemeTokens } from '@/lib/themes/types'
import type { ThemeFont } from '@/components/providers/theme/types'
import { generateScopedThemeCSS } from '@/lib/themes/utils'
import { ThemePreviewElements } from './ThemePreviewElements'

export interface ThemePreviewPanelProps {
  /** Theme tokens to apply */
  tokens: ThemeTokens
  /** Theme ID (used for generating unique scope class) */
  themeId: string
  /** Color mode to preview */
  mode: 'light' | 'dark'
  /** Custom fonts to load */
  fonts?: ThemeFont[]
  /** Additional CSS overrides from the theme */
  cssOverrides?: string | null
  /** Optional label to display above the preview */
  label?: string
}

/**
 * Transform theme CSS overrides to use scoped selectors
 *
 * Replaces [data-theme="theme-id"] selectors with the scoped class,
 * handling light/dark mode suffixes appropriately.
 */
function scopeThemeCSS(
  cssOverrides: string,
  themeId: string,
  scopeClass: string,
  mode: 'light' | 'dark'
): string {
  // Build regex patterns for the theme's selectors
  // Escape special regex characters in themeId
  const escapedThemeId = themeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Match [data-theme="theme-id"] with optional .light or .dark suffix
  const themeAttrPattern = new RegExp(
    `\\[data-theme=["']${escapedThemeId}["']\\](\\.light|\\.dark)?`,
    'g'
  )

  // Process the CSS
  let scopedCSS = ''
  let currentPos = 0
  let braceDepth = 0
  let currentRule = ''
  let inAtRule = false
  let atRuleType = ''

  // Simple state machine to parse CSS
  for (let i = 0; i < cssOverrides.length; i++) {
    const char = cssOverrides[i]

    // Track @ rules (media queries, keyframes, font-face)
    if (char === '@' && braceDepth === 0) {
      inAtRule = true
      // Find the @ rule name
      let endOfName = i + 1
      while (endOfName < cssOverrides.length && /[a-zA-Z-]/.test(cssOverrides[endOfName])) {
        endOfName++
      }
      atRuleType = cssOverrides.substring(i + 1, endOfName)
    }

    if (char === '{') {
      braceDepth++
    } else if (char === '}') {
      braceDepth--

      if (braceDepth === 0) {
        // End of a top-level rule
        currentRule += char

        // Check if this rule should be included based on mode
        const hasLightSuffix = currentRule.includes(`[data-theme="${themeId}"].light`) ||
                              currentRule.includes(`[data-theme='${themeId}'].light`)
        const hasDarkSuffix = currentRule.includes(`[data-theme="${themeId}"].dark`) ||
                             currentRule.includes(`[data-theme='${themeId}'].dark`)

        // Skip rules that don't match our mode
        // Rules without suffix apply to both modes
        const shouldInclude = mode === 'light'
          ? !hasDarkSuffix  // Include if not dark-specific
          : !hasLightSuffix // Include if not light-specific

        if (shouldInclude) {
          // Transform the selectors
          let transformedRule = currentRule.replace(themeAttrPattern, (match, suffix) => {
            // Replace [data-theme="..."] with our scope class
            return `.${scopeClass}`
          })

          // Skip @font-face and @keyframes rules (don't scope them)
          if (atRuleType === 'font-face' || atRuleType === 'keyframes') {
            scopedCSS += currentRule
          } else {
            scopedCSS += transformedRule
          }
        }

        currentRule = ''
        inAtRule = false
        atRuleType = ''
        continue
      }
    }

    currentRule += char
  }

  return scopedCSS
}

/**
 * Renders a theme preview with isolated scoped CSS
 */
export function ThemePreviewPanel({
  tokens,
  themeId,
  mode,
  fonts,
  cssOverrides,
  label,
}: ThemePreviewPanelProps) {
  // Generate a unique ID for this instance to avoid conflicts
  const instanceId = useId().replace(/:/g, '')

  // Generate the scoped class name
  const scopeClass = `theme-preview-${themeId.replace(/[^a-zA-Z0-9-]/g, '-')}-${mode}-${instanceId}`

  // Convert ThemeFont[] to FontFaceDefinition[] for the utility function
  const fontDefinitions = useMemo(() => {
    if (!fonts || fonts.length === 0) return undefined
    return fonts.map((font) => ({
      family: font.family,
      src: font.src,
      weight: font.weight,
      style: font.style,
      display: font.display,
    }))
  }, [fonts])

  // Generate the scoped CSS
  const scopedCSS = useMemo(() => {
    let css = generateScopedThemeCSS(tokens, fontDefinitions, scopeClass, mode)

    // Append transformed CSS overrides from the theme
    if (cssOverrides) {
      const transformedOverrides = scopeThemeCSS(cssOverrides, themeId, scopeClass, mode)
      if (transformedOverrides.trim()) {
        css += `\n\n/* Theme CSS Overrides (scoped) */\n${transformedOverrides}`
      }
    }

    return css
  }, [tokens, fontDefinitions, scopeClass, mode, cssOverrides, themeId])

  return (
    <div className="flex-1 min-w-0">
      {/* Label */}
      {label && (
        <div className="text-center mb-2">
          <span className="qt-text-xs font-medium uppercase tracking-wide">
            {label}
          </span>
        </div>
      )}

      {/* Inject scoped CSS */}
      <style dangerouslySetInnerHTML={{ __html: scopedCSS }} />

      {/* Preview container with scoped class */}
      {/* Override height: 100dvh that some themes set on root */}
      <div
        className={`${scopeClass} rounded-lg border qt-border-default overflow-hidden`}
        style={{ height: 'auto', minHeight: 'auto', maxHeight: 'none' }}
      >
        <ThemePreviewElements />
      </div>
    </div>
  )
}
