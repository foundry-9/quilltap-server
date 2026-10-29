/**
 * The diagram lightbox: opens at Fit, 100% and Fit on demand, wheel zoom,
 * Escape that the Salon behind never hears, and Copy PNG with and without
 * transparency. The PNG pipeline itself is covered in export-png.test.ts.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DiagramLightbox } from '@/components/chat/diagrams/DiagramLightbox'
import { diagramToPngBlob } from '@/components/chat/diagrams/export-png'
import { copyPngBlobToClipboard } from '@/lib/clipboard-utils'

jest.mock('@/components/chat/diagrams/export-png', () => ({
  ...jest.requireActual('@/components/chat/diagrams/export-png'),
  diagramToPngBlob: jest.fn(),
}))
jest.mock('@/lib/clipboard-utils', () => ({ copyPngBlobToClipboard: jest.fn() }))
jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showInfoToast: jest.fn() }))

const exportMock = jest.mocked(diagramToPngBlob)
const clipboardMock = jest.mocked(copyPngBlobToClipboard)

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200"/></svg>'

// jsdom lays nothing out; give every element the viewport's size.
const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1048 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 648 })
})
afterAll(() => {
  if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth)
  if (realHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', realHeight)
})

const zoomReadout = () => screen.getByLabelText(/^Zoom \d+%$/).textContent

describe('DiagramLightbox', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    exportMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    clipboardMock.mockImplementation(async (png) => {
      await png
    })
  })

  it('opens at Fit, and switches between 100% and Fit', () => {
    render(<DiagramLightbox svg={SVG} label="Diagram, enlarged" onClose={jest.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Diagram, enlarged' })).toBeInTheDocument()
    // (1048 − 48) / 400 = 2.5
    expect(zoomReadout()).toBe('250%')
    expect(screen.getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '100%' }))
    expect(zoomReadout()).toBe('100%')
    expect(screen.getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: /Fit/ }))
    expect(zoomReadout()).toBe('250%')
  })

  it('gives a drawing with no viewBox one, so zooming scales it', () => {
    const sketch = '<svg xmlns="http://www.w3.org/2000/svg" width="544" height="325"><rect width="544" height="325"/></svg>'
    render(<DiagramLightbox svg={sketch} label="Diagram" onClose={jest.fn()} />)
    expect(document.querySelector('.qt-diagram-lightbox-sheet svg')).toHaveAttribute('viewBox', '0 0 544 325')
  })

  it('zooms in on wheel-up and out with the zoom-out button', () => {
    const { container } = render(<DiagramLightbox svg={SVG} label="Diagram" onClose={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '100%' }))
    const viewport = container.querySelector('.qt-diagram-lightbox-viewport') as HTMLElement
    act(() => {
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true }))
    })
    expect(parseInt(zoomReadout() ?? '0', 10)).toBeGreaterThan(100)

    fireEvent.click(screen.getByRole('button', { name: '100%' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(zoomReadout()).toBe('80%')
  })

  it('closes on Escape before anything behind it hears the key', () => {
    const onClose = jest.fn()
    const behind = jest.fn()
    document.addEventListener('keydown', behind)
    render(<DiagramLightbox svg={SVG} label="Diagram" onClose={onClose} />)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(behind).not.toHaveBeenCalled()
    document.removeEventListener('keydown', behind)
  })

  it('copies a 2× PNG on the diagram background by default', async () => {
    render(<DiagramLightbox svg={SVG} label="Diagram" onClose={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Copy PNG/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument())
    expect(exportMock).toHaveBeenCalledWith(
      expect.any(SVGSVGElement),
      expect.objectContaining({ transparent: false, scale: 2 }),
    )
    expect(clipboardMock).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('copies with a transparent background when Transparent is ticked', async () => {
    render(<DiagramLightbox svg={SVG} label="Diagram" onClose={jest.fn()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Transparent' }))
    fireEvent.click(screen.getByRole('button', { name: /Copy PNG/ }))
    await waitFor(() => expect(exportMock).toHaveBeenCalled())
    expect(exportMock).toHaveBeenCalledWith(expect.any(SVGSVGElement), expect.objectContaining({ transparent: true }))
    // Ticking it previews the transparency behind the drawing.
    expect(document.querySelector('.qt-diagram-lightbox-sheet')).toHaveAttribute('data-transparent', 'true')
  })
})
