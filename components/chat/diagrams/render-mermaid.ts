/**
 * Mermaid renderer. Loaded only when a ```mermaid fence is first drawn — the
 * library is large and most chats never need it.
 */

import type { Mermaid, MermaidConfig } from 'mermaid'
import type { DiagramStyle } from '@/lib/markdown/diagrams'
import { enqueueRender, nextRenderId, seedFromSource } from './render-queue'
import { readDiagramPalette, type DiagramPalette } from './diagram-theme'
import type { RenderedDiagram } from './types'

let mermaidPromise: Promise<Mermaid> | null = null

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then((m) => m.default)
      .catch((err) => {
        mermaidPromise = null
        throw err
      })
  }
  return mermaidPromise
}

function configFor(palette: DiagramPalette, style: DiagramStyle, seed: number): MermaidConfig {
  const handDrawn = style === 'handDrawn'
  const fontFamily = handDrawn ? palette.handFontFamily : palette.fontFamily
  return {
    startOnLoad: false,
    // No click handlers, no HTML labels, labels sanitized; diagram-side
    // `%%{init}%%` directives cannot loosen it (securityLevel is a secure key).
    securityLevel: 'strict',
    // Plain SVG text rather than <foreignObject> HTML labels: safer, and the
    // copied / downloaded SVG then reads correctly outside a browser.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: 'base',
    look: handDrawn ? 'handDrawn' : 'classic',
    // Stable wobble: the same source always sketches the same way.
    handDrawnSeed: seed,
    fontFamily,
    themeVariables: {
      darkMode: palette.darkMode,
      background: palette.card,
      fontFamily,
      primaryColor: palette.secondary,
      primaryTextColor: palette.secondaryForeground,
      primaryBorderColor: palette.primary,
      secondaryColor: palette.accent,
      secondaryTextColor: palette.accentForeground,
      secondaryBorderColor: palette.border,
      tertiaryColor: palette.muted,
      tertiaryTextColor: palette.foreground,
      tertiaryBorderColor: palette.border,
      mainBkg: palette.secondary,
      nodeBorder: palette.primary,
      clusterBkg: palette.muted,
      clusterBorder: palette.border,
      lineColor: palette.mutedForeground,
      textColor: palette.foreground,
      titleColor: palette.foreground,
      edgeLabelBackground: palette.card,
      noteBkgColor: palette.accent,
      noteTextColor: palette.accentForeground,
      noteBorderColor: palette.border,
      actorBkg: palette.secondary,
      actorBorder: palette.primary,
      actorTextColor: palette.secondaryForeground,
      signalColor: palette.foreground,
      signalTextColor: palette.foreground,
      labelBoxBkgColor: palette.secondary,
      labelTextColor: palette.foreground,
    },
  }
}

/**
 * Parse, then render, one Mermaid diagram. A syntax error rejects with
 * Mermaid's own message (from `parse`, before any render is attempted).
 */
export function renderMermaid(
  source: string,
  options: { style: DiagramStyle; host: Element },
): Promise<RenderedDiagram> {
  return enqueueRender(async () => {
    const mermaid = await loadMermaid()
    const palette = readDiagramPalette(options.host)
    // Re-initialize inside the queue before every render: the look and the
    // theme are initialize-time options, and nothing else can interleave here.
    mermaid.initialize(configFor(palette, options.style, seedFromSource(source)))

    await mermaid.parse(source)

    const id = nextRenderId('qt-mermaid')
    try {
      const { svg } = await mermaid.render(id, source)
      return { svg }
    } finally {
      // Mermaid leaves its scratch element (and, on failure, an error SVG)
      // in <body>; never let one linger.
      document.getElementById(id)?.remove()
      document.getElementById(`d${id}`)?.remove()
    }
  })
}
