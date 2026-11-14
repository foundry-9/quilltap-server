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
export function getLuminance(color: string): number {
  let r: number, g: number, b: number

  const hsl = color.match(/hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/)
  if (hsl) {
    // Convert HSL to sRGB so the luminance is the real WCAG figure, not the
    // HSL lightness (which calls a saturated yellow and a saturated blue of
    // the same lightness equally bright).
    const h = parseFloat(hsl[1]) / 360
    const s = parseFloat(hsl[2]) / 100
    const l = parseFloat(hsl[3]) / 100
    const channel = (n: number) => {
      const k = (n + h * 12) % 12
      const a = s * Math.min(l, 1 - l)
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    }
    r = channel(0)
    g = channel(8)
    b = channel(4)
  } else if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16) / 255
      g = parseInt(hex[1] + hex[1], 16) / 255
      b = parseInt(hex[2] + hex[2], 16) / 255
    } else {
      r = parseInt(hex.slice(0, 2), 16) / 255
      g = parseInt(hex.slice(2, 4), 16) / 255
      b = parseInt(hex.slice(4, 6), 16) / 255
    }
  } else {
    return 0.5 // unparseable — treat as mid-grey
  }

  // Apply gamma correction
  r = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  g = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  b = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two relative luminances. */
function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/** Pick whichever candidate stands out more against the background. */
function pickByContrast(bgColor: string, onLight: string, onDark: string): string {
  const bg = getLuminance(bgColor)
  return contrastRatio(bg, getLuminance(onLight)) >= contrastRatio(bg, getLuminance(onDark))
    ? onLight
    : onDark
}

/**
 * Get contrasting text color (white or dark) based on background.
 * Chooses by WCAG contrast ratio, so a mid-tone background (where a fixed
 * luminance cut-off would hand back white at under 3:1) gets the dark ink.
 */
export function getContrastingTextColor(bgColor: string): string {
  return pickByContrast(bgColor, '#1a1a1a', '#ffffff')
}

/**
 * Get muted text color based on background
 */
export function getMutedTextColor(bgColor: string): string {
  return pickByContrast(bgColor, '#555555', '#b0b0b0')
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
