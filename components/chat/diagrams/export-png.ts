/**
 * Diagram → PNG, for the lightbox's Copy PNG.
 *
 * The drawing is serialized, loaded as an SVG image and painted onto a canvas.
 * An SVG image is a sealed document — it sees none of the page's stylesheets,
 * none of its web fonts, and no `currentColor` but black — so a naive copy of
 * the on-page markup comes out wrong in three ways, each fixed here on a clone
 * (the drawing on the page is never touched):
 *
 *  1. **`<foreignObject>` labels.** Mermaid draws flowchart labels as SVG text
 *     here (`htmlLabels: false`), but several diagram kinds — Venn, event
 *     model, architecture, math labels, any `textPlacement: 'fo'` — still put
 *     HTML in a `<foreignObject>`. On a canvas that either taints it (no
 *     export at all) or paints empty boxes. Each one is replaced: dropped when
 *     it sits in a `<switch>` that already carries an SVG-text fallback, and
 *     otherwise redrawn as centred SVG `<text>` in the label's own computed
 *     font, size and colour.
 *  2. **Web fonts.** Every family the drawing's text resolves to is looked up
 *     in the page's `@font-face` rules, and the matching faces are embedded
 *     as data URLs in a `<style>` inside the clone. (System fonts need no help.)
 *  3. **Inherited colour and type.** `currentColor` — Graphviz's ink — and
 *     unstyled text inherit from the root, so the root is given the live
 *     drawing's computed colour, font family and font size.
 *
 * It is drawn at twice its natural size by default, never larger than a canvas
 * the browser will agree to, onto the diagram's own background unless the
 * caller asks for transparency.
 */

import { naturalSvgSize } from './lightbox-geometry'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** The default export resolution: two device pixels per CSS pixel. */
export const PNG_EXPORT_SCALE = 2

// Safari refuses canvases past ~16.7 megapixels and every engine past 16384 a
// side; a toBlob on either comes back null. Shrink the scale to stay inside.
const MAX_CANVAS_SIDE = 16384
const MAX_CANVAS_AREA = 16_777_216

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', 'inherit', 'initial', 'unset', 'revert',
])

export type DiagramExportFailure = 'tainted' | 'too-large' | 'load-failed'

export class DiagramExportError extends Error {
  constructor(readonly reason: DiagramExportFailure, message: string) {
    super(message)
    this.name = 'DiagramExportError'
  }
}

export interface PngExportOptions {
  /** Device pixels per CSS pixel. Defaults to {@link PNG_EXPORT_SCALE}. */
  scale?: number
  /** Leave the background transparent rather than painting `background`. */
  transparent?: boolean
  /** The colour behind the drawing when not transparent (any CSS colour). */
  background?: string
}

export interface PreparedSvg {
  /** Standalone SVG markup, sized in device pixels. */
  markup: string
  width: number
  height: number
  /** The scale actually used — below the request only for an enormous drawing. */
  scale: number
  /** How many `<foreignObject>` islands were replaced. */
  replacedForeignObjects: number
  /** The font families embedded. */
  embeddedFamilies: string[]
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/** Split a CSS `font-family` stack into bare, lower-cased names. */
export function parseFontFamilies(stack: string): string[] {
  const names: string[] = []
  for (const raw of stack.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []) {
    const name = raw.trim().replace(/^["']|["']$/g, '').trim().toLowerCase()
    if (name && !GENERIC_FAMILIES.has(name) && !name.startsWith('var(')) names.push(name)
  }
  return names
}

function* walkRules(rules: CSSRuleList): Generator<CSSRule> {
  for (const rule of Array.from(rules)) {
    yield rule
    // @media, @supports, @layer blocks — anything that nests rules.
    const nested = (rule as CSSGroupingRule).cssRules
    if (nested) yield* walkRules(nested)
  }
}

function isFontFaceRule(rule: CSSRule): rule is CSSFontFaceRule {
  // CSSRule.FONT_FACE_RULE is 5; the constant outlives the deprecated `type`.
  return (typeof CSSFontFaceRule !== 'undefined' && rule instanceof CSSFontFaceRule) || rule.type === 5
}

interface FontFaceSource {
  family: string
  /** The face's descriptors other than `src`, ready to copy. */
  descriptors: string
  url: string
  format: string | null
}

/** Every `@font-face` on the page for one of `families`, with its best `src`. */
function findFontFaces(families: Set<string>): FontFaceSource[] {
  const found: FontFaceSource[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // a cross-origin sheet hides its rules
    }
    const base = sheet.href ?? document.baseURI
    for (const rule of walkRules(rules)) {
      if (!isFontFaceRule(rule)) continue
      const style = rule.style
      const family = style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '')
      if (!families.has(family.toLowerCase())) continue

      const sources = Array.from(
        style.getPropertyValue('src').matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)\s*(?:format\(\s*['"]?([^'")]+)['"]?\s*\))?/g),
      ).map((m) => ({ url: m[2], format: m[3] ?? null }))
      const best = sources.find((s) => s.format === 'woff2' || /\.woff2(\?|$)/i.test(s.url)) ?? sources[0]
      if (!best) continue // local() only: already on this machine

      const descriptors = ['font-weight', 'font-style', 'font-stretch', 'unicode-range']
        .map((name) => [name, style.getPropertyValue(name).trim()] as const)
        .filter(([, value]) => value)
        .map(([name, value]) => `${name}:${value};`)
        .join('')
      let url: string
      try {
        url = new URL(best.url, base).href
      } catch {
        continue
      }
      found.push({ family, descriptors, url, format: best.format })
    }
  }
  return found
}

const fontDataUrls = new Map<string, Promise<string | null>>()

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** A font file as a data URL, fetched once per page; null when it cannot be had. */
function fontAsDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return Promise.resolve(url)
  let pending = fontDataUrls.get(url)
  if (!pending) {
    pending = fetch(url)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(blobToDataUrl)
      .catch((err: unknown) => {
        console.debug('[diagrams] Could not embed a font for PNG export', {
          url,
          error: err instanceof Error ? err.message : String(err),
        })
        fontDataUrls.delete(url)
        return null
      })
    fontDataUrls.set(url, pending)
  }
  return pending
}

/** Test seam: forget every fetched font. */
export function clearEmbeddedFontCache(): void {
  fontDataUrls.clear()
}

async function fontFaceCss(families: Set<string>): Promise<{ css: string; embedded: string[] }> {
  const faces = findFontFaces(families)
  const rules = await Promise.all(
    faces.map(async (face) => {
      const data = await fontAsDataUrl(face.url)
      if (!data) return null
      const format = face.format ? ` format("${face.format}")` : ''
      return `@font-face{font-family:"${face.family}";src:url("${data}")${format};${face.descriptors}}`
    }),
  )
  const kept = rules.filter((r): r is string => r !== null)
  const embedded = Array.from(new Set(faces.filter((_, i) => rules[i] !== null).map((f) => f.family)))
  return { css: kept.join('\n'), embedded }
}

// ---------------------------------------------------------------------------
// foreignObject → SVG text
// ---------------------------------------------------------------------------

function numberAttr(el: Element, name: string): number {
  const n = parseFloat(el.getAttribute(name) ?? '')
  return Number.isFinite(n) ? n : 0
}

/** The visible lines of an HTML label, as the reader sees them. */
function labelLines(live: Element): string[] {
  // innerText honours <br> and block boundaries, but only an HTML element has
  // it — not the <foreignObject> itself — so read the HTML inside. (jsdom
  // lacks innerText altogether; textContent is the fallback.)
  const html = Array.from(live.children).filter(
    (child): child is HTMLElement => typeof (child as HTMLElement).innerText === 'string',
  )
  const text = html.length > 0 ? html.map((child) => child.innerText).join('\n') : (live.textContent ?? '')
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** The element whose computed style the label's text is actually drawn in. */
function textBearer(live: Element): Element {
  const walker = document.createTreeWalker(live, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.textContent ?? '').trim() && node.parentElement) return node.parentElement
  }
  return live
}

function foreignObjectAsText(live: Element, clone: Element): { node: Element; family: string } | null {
  const lines = labelLines(live)
  if (lines.length === 0) return null

  const style = getComputedStyle(textBearer(live))
  const fontSize = parseFloat(style.fontSize) || 14
  const lineHeight = fontSize * 1.2
  const cx = numberAttr(clone, 'x') + numberAttr(clone, 'width') / 2
  const cy = numberAttr(clone, 'y') + numberAttr(clone, 'height') / 2

  const text = document.createElementNS(SVG_NS, 'text')
  text.setAttribute('text-anchor', 'middle')
  text.setAttribute('dominant-baseline', 'central')
  text.setAttribute('font-size', `${fontSize}px`)
  if (style.fontFamily) text.setAttribute('font-family', style.fontFamily)
  if (style.fontWeight && style.fontWeight !== '400' && style.fontWeight !== 'normal') {
    text.setAttribute('font-weight', style.fontWeight)
  }
  if (style.fontStyle && style.fontStyle !== 'normal') text.setAttribute('font-style', style.fontStyle)
  if (style.color) text.setAttribute('fill', style.color)
  const transform = clone.getAttribute('transform')
  if (transform) text.setAttribute('transform', transform)

  lines.forEach((line, i) => {
    const tspan = document.createElementNS(SVG_NS, 'tspan')
    tspan.setAttribute('x', String(cx))
    tspan.setAttribute('y', String(cy + (i - (lines.length - 1) / 2) * lineHeight))
    tspan.textContent = line
    text.appendChild(tspan)
  })
  return { node: text, family: style.fontFamily }
}

/** True when `fo` sits in a `<switch>` that has something else to draw instead. */
function hasSwitchFallback(fo: Element): boolean {
  const parent = fo.parentElement
  if (!parent || parent.localName !== 'switch') return false
  return Array.from(parent.children).some((child) => child !== fo && child.localName !== 'foreignObject')
}

/**
 * Replace every `<foreignObject>` in `clone` (a deep clone of `live`, so the
 * two lists line up). Returns the count and any font families it introduced.
 */
function replaceForeignObjects(live: Element, clone: Element): { count: number; families: string[] } {
  const liveIslands = Array.from(live.getElementsByTagNameNS(SVG_NS, 'foreignObject'))
  const cloneIslands = Array.from(clone.getElementsByTagNameNS(SVG_NS, 'foreignObject'))
  const families: string[] = []
  cloneIslands.forEach((fo, i) => {
    // An island nested in an island goes with its parent.
    if (!clone.contains(fo)) return
    if (hasSwitchFallback(fo)) {
      fo.remove()
      return
    }
    const redrawn = liveIslands[i] ? foreignObjectAsText(liveIslands[i], fo) : null
    if (redrawn) {
      fo.replaceWith(redrawn.node)
      families.push(redrawn.family)
    } else {
      fo.remove()
    }
  })
  return { count: cloneIslands.length, families }
}

// ---------------------------------------------------------------------------
// Prepare and rasterize
// ---------------------------------------------------------------------------

/** The largest scale ≤ `wanted` at which a `size` drawing fits a canvas. */
export function safeExportScale(size: { width: number; height: number }, wanted: number): number {
  const bySide = MAX_CANVAS_SIDE / Math.max(size.width, size.height)
  const byArea = Math.sqrt(MAX_CANVAS_AREA / (size.width * size.height))
  return Math.max(0.01, Math.min(wanted, bySide, byArea))
}

/**
 * Build standalone, self-sufficient SVG markup from the drawing as it stands
 * on the page. `live` must be laid out (in the document) so computed styles
 * can be read.
 */
export async function prepareSvgForRaster(live: SVGSVGElement, options: { scale?: number } = {}): Promise<PreparedSvg> {
  const natural = naturalSvgSize(live)
  const scale = safeExportScale(natural, options.scale ?? PNG_EXPORT_SCALE)
  const width = Math.max(1, Math.round(natural.width * scale))
  const height = Math.max(1, Math.round(natural.height * scale))

  const clone = live.cloneNode(true) as SVGSVGElement
  const { count, families: labelFamilies } = replaceForeignObjects(live, clone)

  // Size it in device pixels; the viewBox keeps the drawing's own coordinates.
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${natural.width} ${natural.height}`)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('xmlns', SVG_NS)
  const rootStyle = getComputedStyle(live)
  for (const prop of ['width', 'height', 'max-width', 'max-height', 'min-width', 'min-height']) {
    clone.style.removeProperty(prop)
  }
  if (rootStyle.color) clone.style.setProperty('color', rootStyle.color)
  if (rootStyle.fontFamily) clone.style.setProperty('font-family', rootStyle.fontFamily)
  if (rootStyle.fontSize) clone.style.setProperty('font-size', rootStyle.fontSize)

  // Every family the text is drawn in.
  const families = new Set<string>()
  const addStack = (stack: string | null | undefined) => {
    if (stack) for (const name of parseFontFamilies(stack)) families.add(name)
  }
  addStack(rootStyle.fontFamily)
  labelFamilies.forEach(addStack)
  for (const el of Array.from(live.querySelectorAll('text, tspan, textPath'))) {
    addStack(getComputedStyle(el).fontFamily)
  }

  const { css, embedded } = families.size > 0 ? await fontFaceCss(families) : { css: '', embedded: [] }
  if (css) {
    const styleEl = document.createElementNS(SVG_NS, 'style')
    styleEl.textContent = css
    clone.insertBefore(styleEl, clone.firstChild)
  }

  console.debug('[diagrams] Prepared diagram for PNG export', {
    width,
    height,
    scale,
    replacedForeignObjects: count,
    embeddedFamilies: embedded,
  })

  return {
    markup: new XMLSerializer().serializeToString(clone),
    width,
    height,
    scale,
    replacedForeignObjects: count,
    embeddedFamilies: embedded,
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new DiagramExportError('load-failed', 'The drawing could not be read back as an image'))
    // A data URL, not a blob: one — the CSP's img-src admits data: only.
    img.src = src
  })
}

/** Paint prepared markup onto a canvas and encode it as PNG. */
export async function rasterizePreparedSvg(prepared: PreparedSvg, options: PngExportOptions = {}): Promise<Blob> {
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(prepared.markup)}`)
  // Let embedded fonts finish decoding before the paint.
  await img.decode?.().catch(() => undefined)

  const canvas = document.createElement('canvas')
  canvas.width = prepared.width
  canvas.height = prepared.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new DiagramExportError('too-large', 'The browser would not lend a canvas that size')
  if (!options.transparent && options.background) {
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new DiagramExportError('too-large', 'The browser could not encode a picture that large'))
      }, 'image/png')
    } catch (err) {
      // A tainted canvas throws SecurityError here.
      reject(
        new DiagramExportError(
          'tainted',
          `The browser refused to export this drawing (${err instanceof Error ? err.message : String(err)})`,
        ),
      )
    }
  })
}

/** The whole pipeline: the drawing on the page → a PNG blob. */
export async function diagramToPngBlob(live: SVGSVGElement, options: PngExportOptions = {}): Promise<Blob> {
  const prepared = await prepareSvgForRaster(live, { scale: options.scale })
  return rasterizePreparedSvg(prepared, options)
}
