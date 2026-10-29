/**
 * The one DOMPurify call site for diagram SVG.
 *
 * Model-written ```svg blocks and Graphviz output both pass through here
 * before they reach the page. Mermaid's own output does not: it is produced
 * under `securityLevel: 'strict'`, which sanitizes labels itself, and its
 * scoped `<style>` element is load-bearing.
 *
 * What is stripped, and why:
 *  - `<script>`, every `on*` handler, `javascript:` URLs — script execution.
 *  - `<foreignObject>` — an HTML island inside the SVG, outside every rule here.
 *  - `<style>` — inline SVG is not a sandbox: a `<style>` in it styles the
 *    whole page.
 *  - `<image>`, and every `href` / `xlink:href` that is not a `#fragment` —
 *    external fetches, and a photo smuggled past the "Salon Images" quick-hide.
 *  - Any attribute carrying `url(...)` that is not `url(#...)` — the same
 *    external fetch, through a presentation attribute or `style`. A `style`
 *    attribute is otherwise kept: it styles only its own element.
 */

import DOMPurify, { type DOMPurify as DOMPurifyInstance } from 'dompurify'

let purifier: DOMPurifyInstance | null = null

/** True when a value names any `url(...)` that is not a `url(#fragment)`. */
function hasExternalUrl(value: string): boolean {
  const targets = value.match(/url\s*\(\s*['"]?[^'")\s]*/gi)
  if (!targets) return false
  return targets.some((t) => !/url\s*\(\s*['"]?#/i.test(t))
}

function getPurifier(): DOMPurifyInstance {
  if (purifier) return purifier
  // A private instance, so these hooks never touch any other DOMPurify user.
  const instance = DOMPurify(window)
  instance.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = data.attrName.toLowerCase()
    const value = data.attrValue.trim()
    if (name === 'href' || name === 'xlink:href') {
      if (!value.startsWith('#')) data.keepAttr = false
      return
    }
    if (hasExternalUrl(value)) data.keepAttr = false
  })
  purifier = instance
  return instance
}

/**
 * Sanitize an SVG document and return it as standalone markup (namespaced,
 * so it also stands on its own as a downloaded `.svg` file), or `null` when
 * the result is not exactly one `<svg>` element.
 */
export function sanitizeSvg(svg: string): string | null {
  const root = sanitizeSvgElement(svg)
  return root ? new XMLSerializer().serializeToString(root) : null
}

/** As {@link sanitizeSvg}, returning the live element rather than markup. */
export function sanitizeSvgElement(svg: string): SVGSVGElement | null {
  const fragment = getPurifier().sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'style', 'image', 'iframe', 'object', 'embed'],
    // DOMPurify leaves <use> out of its SVG profile because it can pull in an
    // external document; the href hook above confines it to #fragments, which
    // is all a hand-drawn SVG needs it for (repeating a shape).
    ADD_TAGS: ['use'],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  })
  const elements = Array.from(fragment.childNodes).filter(
    (n) => n.nodeType === 1 || (n.nodeType === 3 && (n.textContent ?? '').trim() !== ''),
  )
  if (elements.length !== 1) return null
  const root = elements[0] as Element
  if (root.nodeType !== 1 || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
    return null
  }
  return root as SVGSVGElement
}

/** True when the text, ignoring a leading XML prolog and comments, starts with an `<svg` root. */
export function looksLikeSvgRoot(source: string): boolean {
  const stripped = source
    .replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trimStart()
  return /^<svg[\s>]/i.test(stripped)
}
