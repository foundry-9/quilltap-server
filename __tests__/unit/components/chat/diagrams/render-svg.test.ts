/**
 * The raw-SVG renderer: refuses a non-<svg> root, and sizes a drawing to fit
 * its container without losing its proportions.
 */

import { renderSvg } from '@/components/chat/diagrams/render-svg'

describe('renderSvg', () => {
  it('trades fixed width/height for a viewBox and a capped natural width', async () => {
    const { svg } = await renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="10" height="10"/></svg>')
    expect(svg).toContain('viewBox="0 0 160 120"')
    expect(svg).not.toMatch(/\swidth="160"/)
    expect(svg).not.toMatch(/\sheight="120"/)
    expect(svg).toContain('width:160px;max-width:100%;height:auto;')
  })

  it('keeps an existing viewBox', async () => {
    const { svg } = await renderSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 25"><rect/></svg>')
    expect(svg).toContain('viewBox="0 0 50 25"')
    expect(svg).toContain('width:100%;max-width:100%;height:auto;')
  })

  it('refuses a block whose root is not <svg>', async () => {
    await expect(renderSvg('<div><svg></svg></div>')).rejects.toThrow(/must start with an <svg>/)
  })

  it('refuses a block nothing drawable survives', async () => {
    await expect(renderSvg('<svg><script>alert(1)</script></svg><svg></svg>')).rejects.toThrow(/sanitizing/)
  })
})
