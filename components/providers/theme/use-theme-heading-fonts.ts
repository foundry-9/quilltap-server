'use client'

/**
 * useThemeHeadingFonts
 *
 * Loads each listed theme's heading font (when it is a bundle font) so a
 * theme picker can set the theme's name in its own face. One shared style
 * element; the faces are only declared, so the browser fetches a font only
 * when a name is actually drawn in it.
 *
 * @module providers/theme/use-theme-heading-fonts
 */

import { useEffect, useMemo } from 'react'
import type { ThemeSummary } from './types'

const STYLE_ID = 'theme-preview-fonts'

function fontFormat(url: string): string {
  const pathname = url.split('?')[0].toLowerCase()
  if (pathname.endsWith('.woff2')) return 'woff2'
  if (pathname.endsWith('.ttf')) return 'truetype'
  if (pathname.endsWith('.otf')) return 'opentype'
  return 'woff'
}

/** Escape a value for a single-quoted CSS string. */
function cssQuoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\n\r]/g, ' ')}'`
}

/** The @font-face rules for the given themes' bundle heading fonts. */
export function headingFontFacesCss(themes: readonly (ThemeSummary | null | undefined)[]): string {
  const seen = new Set<string>()
  const rules: string[] = []
  for (const theme of themes) {
    const font = theme?.headingFont
    if (!font?.url || seen.has(font.family)) continue
    seen.add(font.family)
    rules.push(
      `@font-face { font-family: ${cssQuoted(font.family)}; src: url(${cssQuoted(font.url)}) format('${fontFormat(font.url)}'); font-display: swap; }`
    )
  }
  return rules.join('\n')
}

/** Inject the heading fonts of `themes` while the caller is mounted. */
export function useThemeHeadingFonts(themes: readonly (ThemeSummary | null | undefined)[]): void {
  const css = useMemo(() => headingFontFacesCss(themes), [themes])

  useEffect(() => {
    if (!css) return
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = STYLE_ID
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = css
    return () => {
      document.getElementById(STYLE_ID)?.remove()
    }
  }, [css])
}
