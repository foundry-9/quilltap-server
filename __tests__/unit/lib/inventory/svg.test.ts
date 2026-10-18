/**
 * The Inventory SVG glyph sanitiser (spec §2, Glyphs).
 */

import { InventorySvgError, sanitizeInventorySvg } from '@/lib/inventory/svg'
import { INVENTORY_SVG_MAX_BYTES } from '@/lib/schemas/inventory.types'

describe('sanitizeInventorySvg', () => {
  it('keeps a plain drawing', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2L22 22" stroke="black"/></svg>'
    expect(sanitizeInventorySvg(svg)).toBe(svg)
  })

  it('treats empty input as no glyph', () => {
    expect(sanitizeInventorySvg('   ')).toBeNull()
    expect(sanitizeInventorySvg(null)).toBeNull()
  })

  it('drops script, foreignObject and style elements with their contents', () => {
    const out = sanitizeInventorySvg(
      '<svg><script>alert(1)</script><foreignObject><div>x</div></foreignObject><style>*{}</style><circle r="2"/></svg>',
    )!
    expect(out).toBe('<svg><circle r="2"/></svg>')
  })

  it('drops event handlers, external hrefs and javascript URLs; keeps fragment refs', () => {
    const out = sanitizeInventorySvg(
      '<svg onload="alert(1)"><use href="https://evil.example/x.svg#a"/><use xlink:href="#ok"/><a href="javascript:alert(1)"><rect/></a></svg>',
    )!
    expect(out).not.toMatch(/onload|evil|javascript/i)
    expect(out).toContain('<use xlink:href="#ok"/>')
  })

  it('drops a style carrying url( and a paint url that leaves the glyph', () => {
    const out = sanitizeInventorySvg(
      '<svg><rect style="fill:url(https://x/y)" fill="url(http://x)"/><rect fill="url(#grad)"/></svg>',
    )!
    expect(out).toBe('<svg><rect/><rect fill="url(#grad)"/></svg>')
  })

  it('drops comments, processing instructions and DOCTYPE entity declarations', () => {
    const out = sanitizeInventorySvg(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><!-- hi --><svg><g/></svg>',
    )
    expect(out).toBe('<svg><g/></svg>')
  })

  it('refuses a document that is not an SVG, and one over the size cap', () => {
    expect(() => sanitizeInventorySvg('<div>hi</div>')).toThrow(InventorySvgError)
    const big = `<svg>${'<g></g>'.repeat(INVENTORY_SVG_MAX_BYTES / 4)}</svg>`
    expect(() => sanitizeInventorySvg(big)).toThrow(InventorySvgError)
  })

  it('closes what it leaves open', () => {
    expect(sanitizeInventorySvg('<svg><g><circle r="1"/>')).toBe('<svg><g><circle r="1"/></g></svg>')
  })
})
