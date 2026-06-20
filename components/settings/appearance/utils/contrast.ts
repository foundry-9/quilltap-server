/**
 * Contrast & badge helpers for theme previews
 *
 * Computes accessible foreground colors from a theme's own background color,
 * so headers/chips painted over theme-derived colors stay legible (the
 * "Option B" banner-contrast approach). Lifted out of ThemeCard so the theme
 * preview modal and the card share one implementation.
 *
 * @module components/settings/appearance/utils/contrast
 */

/**
 * Calculate relative luminance of a color
 * Based on WCAG 2.0 formula
 */
export function getLuminance(hexColor: string): number {
  // Handle hsl() colors
  if (hexColor.startsWith('hsl')) {
    // For HSL, extract lightness value as approximation
    const match = hexColor.match(/hsl\(\s*\d+\s*,?\s*[\d.]+%?\s*,?\s*([\d.]+)%?\s*\)/)
    if (match) {
      return parseFloat(match[1]) / 100
    }
    return 0.5 // fallback
  }

  // Remove # if present
  const hex = hexColor.replace('#', '')

  // Parse RGB values
  let r: number, g: number, b: number
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16) / 255
    g = parseInt(hex[1] + hex[1], 16) / 255
    b = parseInt(hex[2] + hex[2], 16) / 255
  } else {
    r = parseInt(hex.slice(0, 2), 16) / 255
    g = parseInt(hex.slice(2, 4), 16) / 255
    b = parseInt(hex.slice(4, 6), 16) / 255
  }

  // Apply gamma correction
  r = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  g = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  b = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Get contrasting text color (white or dark) based on background
 */
export function getContrastingTextColor(bgColor: string): string {
  const luminance = getLuminance(bgColor)
  return luminance > 0.5 ? '#1a1a1a' : '#ffffff'
}

/**
 * Get muted text color based on background
 */
export function getMutedTextColor(bgColor: string): string {
  const luminance = getLuminance(bgColor)
  return luminance > 0.5 ? '#666666' : '#a0a0a0'
}

/**
 * Get source badge label for a theme's source/deprecation state.
 * Returns null for the default (built-in) theme, which has no badge here.
 */
export function getSourceBadge(
  source?: string,
  deprecated?: boolean
): { label: string; deprecated: boolean } | null {
  switch (source) {
    case 'bundle': return { label: 'Bundle', deprecated: false };
    case 'plugin': return { label: 'Plugin', deprecated: deprecated ?? true };
    default: return null;
  }
}
