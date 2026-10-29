/**
 * Keeping the reader's place while a diagram is in the lightbox: the diagram
 * goes back to the same spot in its scrolling container, whatever moved
 * meanwhile, and focus returns to it without a scroll.
 */

import { captureScrollAnchor, findScrollContainer } from '@/components/chat/diagrams/scroll-anchor'

/**
 * A scrolling transcript with one diagram in it. `above` is the height of the
 * content above the diagram; the diagram's on-screen top is `above − scrollTop`
 * (the container's top is at 0).
 */
function transcript() {
  const container = document.createElement('div')
  container.style.overflowY = 'auto'
  Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 5000 })
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 })
  container.getBoundingClientRect = () => ({ top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) })

  const anchor = document.createElement('div')
  anchor.tabIndex = 0
  const state = { above: 1200 }
  anchor.getBoundingClientRect = () => {
    const top = state.above - container.scrollTop
    return { top, left: 0, right: 800, bottom: top + 200, width: 800, height: 200, x: 0, y: top, toJSON: () => ({}) }
  }
  container.appendChild(anchor)
  document.body.appendChild(container)
  return { container, anchor, state }
}

describe('scroll-anchor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => jest.restoreAllMocks())

  it('finds the scrolling ancestor', () => {
    const { container, anchor } = transcript()
    expect(findScrollContainer(anchor)).toBe(container)
  })

  it('puts the transcript back where it was after something scrolled it', () => {
    const { container, anchor } = transcript()
    container.scrollTop = 1000
    const restore = captureScrollAnchor(anchor)
    container.scrollTop = 4400 // a reply streamed in and the list followed it
    restore()
    expect(container.scrollTop).toBe(1000)
  })

  it('keeps the diagram on the same spot when content above it changed size', () => {
    const { container, anchor, state } = transcript()
    container.scrollTop = 1000
    const restore = captureScrollAnchor(anchor)
    state.above = 1350 // a row above re-measured 150px taller
    restore()
    expect(container.scrollTop).toBe(1150)
    expect(anchor.getBoundingClientRect().top).toBe(200)
  })

  it('falls back to the saved scrollTop when the diagram\'s row was unmounted', () => {
    const { container, anchor } = transcript()
    container.scrollTop = 1000
    const restore = captureScrollAnchor(anchor)
    anchor.remove()
    container.scrollTop = 0
    restore()
    expect(container.scrollTop).toBe(1000)
  })

  it('hands focus back to the diagram without scrolling', () => {
    const { anchor } = transcript()
    const focus = jest.spyOn(anchor, 'focus')
    captureScrollAnchor(anchor)()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})
