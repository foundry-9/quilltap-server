/**
 * The diagram SVG sanitizer against a hostile corpus. Every ```svg block a
 * model writes, and every Graphviz drawing, passes through it before it is
 * inlined into the Salon.
 */

import { looksLikeSvgRoot, sanitizeSvg } from '@/components/chat/diagrams/sanitize-svg'

const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`

describe('sanitizeSvg', () => {
  it('keeps an ordinary drawing', () => {
    const out = sanitizeSvg(wrap('<circle cx="5" cy="5" r="4" fill="red" stroke="#333"/><text x="1" y="9">Hi</text>'))
    expect(out).not.toBeNull()
    expect(out).toContain('<circle')
    expect(out).toContain('fill="red"')
    expect(out).toContain('>Hi</text>')
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('strips <script>', () => {
    const out = sanitizeSvg(wrap('<script>alert(1)</script><rect width="2" height="2"/>'))
    expect(out).not.toMatch(/script/i)
    expect(out).toContain('<rect')
  })

  it('strips on* event handlers', () => {
    const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect onclick="alert(2)" width="2" height="2"/></svg>`)
    expect(out).not.toMatch(/onload|onclick|alert/i)
  })

  it('strips javascript: and other non-fragment hrefs', () => {
    const out = sanitizeSvg(wrap(
      '<a href="javascript:alert(1)"><rect width="1" height="1"/></a>' +
      '<a xlink:href="https://example.com/x"><rect width="1" height="1"/></a>',
    ))
    expect(out).not.toMatch(/javascript:|example\.com/i)
  })

  it('keeps fragment references', () => {
    const out = sanitizeSvg(wrap('<defs><circle id="dot" r="1"/></defs><use href="#dot"/>'))
    expect(out).toContain('href="#dot"')
  })

  it('strips an external <use href>', () => {
    const out = sanitizeSvg(wrap('<use href="https://evil.example/sprite.svg#x"/>'))
    expect(out).not.toMatch(/evil\.example/)
  })

  it('strips <foreignObject>', () => {
    const out = sanitizeSvg(wrap('<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>'))
    expect(out).not.toMatch(/foreignObject|<div/i)
  })

  it('strips <style>, which would style the whole page', () => {
    const out = sanitizeSvg(wrap('<style>body { display: none }</style><rect width="1" height="1"/>'))
    expect(out).not.toMatch(/<style|display: none/)
  })

  it('strips <image>, so a photo cannot slip past the Salon Images quick-hide', () => {
    const out = sanitizeSvg(wrap('<image href="https://example.com/photo.jpg" width="5" height="5"/>'))
    expect(out).not.toMatch(/<image|photo\.jpg/)
  })

  it('drops attributes that fetch an external url(), keeps url(#fragment)', () => {
    const out = sanitizeSvg(wrap(
      '<rect width="1" height="1" fill="url(https://evil.example/p.svg#g)"/>' +
      '<rect width="1" height="1" style="fill: url(\'//evil.example/x\')"/>' +
      '<rect width="1" height="1" fill="url(#grad)"/>',
    ))
    expect(out).not.toMatch(/evil\.example/)
    expect(out).toContain('url(#grad)')
  })

  it('returns null when nothing that is an <svg> remains', () => {
    expect(sanitizeSvg('<div>not a drawing</div>')).toBeNull()
    expect(sanitizeSvg('just words')).toBeNull()
    expect(sanitizeSvg('')).toBeNull()
  })

  it('returns null for two sibling roots', () => {
    expect(sanitizeSvg(`${wrap('<rect/>')}${wrap('<rect/>')}`)).toBeNull()
  })
})

describe('looksLikeSvgRoot', () => {
  it('accepts an <svg> root, with or without a prolog', () => {
    expect(looksLikeSvgRoot('<svg viewBox="0 0 1 1"></svg>')).toBe(true)
    expect(looksLikeSvgRoot('<?xml version="1.0"?>\n<!-- drawn -->\n<svg></svg>')).toBe(true)
  })

  it('refuses anything else at the root', () => {
    expect(looksLikeSvgRoot('<div><svg></svg></div>')).toBe(false)
    expect(looksLikeSvgRoot('<svgfoo/>')).toBe(false)
    expect(looksLikeSvgRoot('hello')).toBe(false)
  })
})
