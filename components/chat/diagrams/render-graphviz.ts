/**
 * Graphviz renderer: DOT → SVG through the WASM build of Graphviz, loaded only
 * when a ```dot / ```graphviz fence is first drawn. A hand-drawn character's
 * graphs are then re-sketched with svg2roughjs.
 */

import type { Graphviz } from '@hpcc-js/wasm-graphviz'
import type { DiagramStyle } from '@/lib/markdown/diagrams'
import { enqueueRender, seedFromSource } from './render-queue'
import { readDiagramPalette } from './diagram-theme'
import { sanitizeSvgElement } from './sanitize-svg'
import type { RenderedDiagram } from './types'

let graphvizPromise: Promise<Graphviz> | null = null

function loadGraphviz(): Promise<Graphviz> {
  if (!graphvizPromise) {
    graphvizPromise = import('@hpcc-js/wasm-graphviz')
      .then((m) => m.Graphviz.load())
      .catch((err) => {
        graphvizPromise = null
        throw err
      })
  }
  return graphvizPromise
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Graphviz has no themes: it draws black on white. Re-point its *defaults* at
 * `currentColor` and drop the white page behind the graph, so a plain DOT
 * graph reads on a dark theme too. Colours the model asked for by name
 * (`color=red`, `fillcolor=...`) are left exactly as written.
 */
function themeGraphvizDefaults(svg: SVGSVGElement): void {
  for (const el of Array.from(svg.querySelectorAll('[stroke="black"], [stroke="#000000"]'))) {
    el.setAttribute('stroke', 'currentColor')
  }
  for (const el of Array.from(svg.querySelectorAll('[fill="black"], [fill="#000000"]'))) {
    el.setAttribute('fill', 'currentColor')
  }
  for (const el of Array.from(svg.querySelectorAll('text:not([fill])'))) {
    el.setAttribute('fill', 'currentColor')
  }
  // The page: the first polygon of the top-level graph group.
  const page = svg.querySelector('g.graph > polygon')
  if (page && /^(white|#ffffff|#fff)$/i.test(page.getAttribute('fill') ?? '')) {
    page.setAttribute('fill', 'none')
  }
}

/**
 * Re-draw a sanitized Graphviz SVG with rough.js. The source is attached
 * offscreen inside `host` while sketching — svg2roughjs measures text with
 * getBBox and resolves `currentColor` through computed styles, both of which
 * need a laid-out element in the themed tree.
 */
async function sketch(svg: SVGSVGElement, source: string, host: Element): Promise<SVGSVGElement> {
  const { Svg2Roughjs, OutputType } = await import('svg2roughjs')
  const palette = readDiagramPalette(host)

  const stage = document.createElement('div')
  stage.setAttribute('aria-hidden', 'true')
  stage.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;'
  const output = document.createElement('div')
  stage.appendChild(svg)
  stage.appendChild(output)
  host.appendChild(stage)
  try {
    const sketcher = new Svg2Roughjs(output, OutputType.SVG, { roughness: 1 })
    sketcher.svg = svg
    sketcher.seed = seedFromSource(source)
    sketcher.fontFamily = palette.handFontFamily
    sketcher.backgroundColor = null
    const sketched = await sketcher.sketch()
    if (!sketched || sketched.namespaceURI !== SVG_NS || sketched.localName !== 'svg') {
      throw new Error('svg2roughjs produced no SVG')
    }
    return sketched as SVGSVGElement
  } finally {
    stage.remove()
  }
}

export function renderGraphviz(
  source: string,
  options: { style: DiagramStyle; host: Element },
): Promise<RenderedDiagram> {
  return enqueueRender(async () => {
    const graphviz = await loadGraphviz()
    // Throws with Graphviz's own message on a syntax error.
    const raw = graphviz.dot(source, 'svg')

    // DOT's URL/href attributes become <a xlink:href> in the output.
    const clean = sanitizeSvgElement(raw)
    if (!clean) throw new Error('Graphviz produced no drawable SVG')
    themeGraphvizDefaults(clean)
    const serializer = new XMLSerializer()

    if (options.style !== 'handDrawn') {
      return { svg: serializer.serializeToString(clean) }
    }

    // A style failure never costs the diagram: fall back to the clean drawing.
    const cleanMarkup = serializer.serializeToString(clean)
    try {
      const sketched = await sketch(clean, source, options.host)
      return { svg: serializer.serializeToString(sketched) }
    } catch (err) {
      console.debug('[diagrams] Hand-drawn Graphviz sketch failed; showing the clean drawing', {
        error: err instanceof Error ? err.message : String(err),
      })
      return { svg: cleanMarkup }
    }
  })
}
