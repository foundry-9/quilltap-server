/**
 * Theme colours for diagrams, read live from the page's CSS variables.
 *
 * Mermaid has a theme system but wants concrete colours (it derives shades
 * from them), and themes write their tokens in whatever CSS colour syntax they
 * like — `hsl(225 14% 97%)`, `oklch(...)`, hex. Each token is resolved here to
 * `#rrggbb` by painting it onto a 1×1 canvas, which understands every syntax
 * the browser does.
 */

export interface DiagramPalette {
  background: string
  foreground: string
  card: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  border: string
  darkMode: boolean
  /** The body face diagrams are lettered in (`--qt-diagram-font`). */
  fontFamily: string
  /** The hand a hand-drawn diagram is lettered in (`--qt-diagram-hand-font`). */
  handFontFamily: string
}

const FALLBACK_LIGHT: Omit<DiagramPalette, 'fontFamily' | 'handFontFamily'> = {
  background: '#f6f7f9',
  foreground: '#1c1f26',
  card: '#ffffff',
  primary: '#2a4fc4',
  primaryForeground: '#ffffff',
  secondary: '#e8ebf2',
  secondaryForeground: '#1c1f26',
  muted: '#eceef3',
  mutedForeground: '#5b6170',
  accent: '#e3e8f7',
  accentForeground: '#1c1f26',
  border: '#d8dbe2',
  darkMode: false,
}

const DEFAULT_FONT = 'ui-sans-serif, system-ui, sans-serif'
const DEFAULT_HAND_FONT = '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Marker Felt", cursive'

let probeContext: CanvasRenderingContext2D | null | undefined

function toHex(color: string, fallback: string): string {
  const value = color.trim()
  if (!value) return fallback
  if (probeContext === undefined) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      probeContext = canvas.getContext('2d', { willReadFrequently: true })
    } catch {
      probeContext = null
    }
  }
  const ctx = probeContext
  if (!ctx) return fallback
  try {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000000'
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    if (a === 0) return fallback
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  } catch {
    return fallback
  }
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** Read the active theme's colours as they apply at `host`. */
export function readDiagramPalette(host: Element): DiagramPalette {
  const style = getComputedStyle(host)
  const read = (name: string) => style.getPropertyValue(name)
  const color = (name: string, key: keyof typeof FALLBACK_LIGHT) =>
    toHex(read(name), FALLBACK_LIGHT[key] as string)

  const background = color('--color-background', 'background')
  const palette = {
    background,
    foreground: color('--color-foreground', 'foreground'),
    card: color('--color-card', 'card'),
    primary: color('--color-primary', 'primary'),
    primaryForeground: color('--color-primary-foreground', 'primaryForeground'),
    secondary: color('--color-secondary', 'secondary'),
    secondaryForeground: color('--color-secondary-foreground', 'secondaryForeground'),
    muted: color('--color-muted', 'muted'),
    mutedForeground: color('--color-muted-foreground', 'mutedForeground'),
    accent: color('--color-accent', 'accent'),
    accentForeground: color('--color-accent-foreground', 'accentForeground'),
    border: color('--color-border', 'border'),
    darkMode: luminance(background) < 0.5,
    fontFamily: read('--qt-diagram-font').trim() || DEFAULT_FONT,
    handFontFamily: read('--qt-diagram-hand-font').trim() || DEFAULT_HAND_FONT,
  }
  return palette
}
