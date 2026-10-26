/**
 * DiagramBlock — routing to the right engine, the streaming hold, the
 * could-not-draw fallback, the toolbar, and quick-hide's indifference.
 *
 * Mermaid and Graphviz cannot lay out under jsdom (no getBBox, no WASM), so
 * the three renderer modules are mocked; each real renderer is exercised in
 * the browser.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DiagramBlock, clearDiagramRenderCache } from '@/components/chat/diagrams/DiagramBlock'
import { renderMermaid } from '@/components/chat/diagrams/render-mermaid'
import { renderGraphviz } from '@/components/chat/diagrams/render-graphviz'
import { renderSvg } from '@/components/chat/diagrams/render-svg'
import { ImagesHiddenProvider } from '@/components/quick-hide/images-hidden-context'

jest.mock('@/components/chat/diagrams/render-mermaid', () => ({ renderMermaid: jest.fn() }))
jest.mock('@/components/chat/diagrams/render-graphviz', () => ({ renderGraphviz: jest.fn() }))
jest.mock('@/components/chat/diagrams/render-svg', () => ({ renderSvg: jest.fn() }))

// The real code block pulls in the Prism highlighter; a stand-in shows the code.
jest.mock('@/components/chat/CodeBlockWithCopy', () => ({
  CodeBlockWithCopy: ({ code, language }: { code: string; language: string }) => (
    <pre data-testid="code-block" data-language={language}>{code}</pre>
  ),
}))

const mermaidMock = jest.mocked(renderMermaid)
const graphvizMock = jest.mocked(renderGraphviz)
const svgMock = jest.mocked(renderSvg)

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" data-testid="drawn"><rect width="1" height="1"/></svg>'

describe('DiagramBlock', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearDiagramRenderCache()
    mermaidMock.mockResolvedValue({ svg: SVG })
    graphvizMock.mockResolvedValue({ svg: SVG })
    svgMock.mockResolvedValue({ svg: SVG })
  })

  it('routes mermaid to the Mermaid renderer with the author\'s style', async () => {
    render(<DiagramBlock engine="mermaid" language="mermaid" source="flowchart TD; A-->B" style="handDrawn" />)
    await waitFor(() => expect(screen.getByTestId('drawn')).toBeInTheDocument())
    expect(mermaidMock).toHaveBeenCalledWith('flowchart TD; A-->B', expect.objectContaining({ style: 'handDrawn' }))
    expect(graphvizMock).not.toHaveBeenCalled()
    expect(svgMock).not.toHaveBeenCalled()
  })

  it('routes graphviz to the Graphviz renderer', async () => {
    render(<DiagramBlock engine="graphviz" language="dot" source="digraph { a -> b }" style="clean" />)
    await waitFor(() => expect(screen.getByTestId('drawn')).toBeInTheDocument())
    expect(graphvizMock).toHaveBeenCalledWith('digraph { a -> b }', expect.objectContaining({ style: 'clean' }))
  })

  it('routes svg to the raw-SVG renderer and marks no style', async () => {
    const { container } = render(<DiagramBlock engine="svg" language="svg" source="<svg/>" style="handDrawn" />)
    await waitFor(() => expect(screen.getByTestId('drawn')).toBeInTheDocument())
    expect(svgMock).toHaveBeenCalledWith('<svg/>')
    expect(container.querySelector('.qt-diagram')).not.toHaveAttribute('data-diagram-style')
  })

  it('shows a fixed placeholder while the drawing is under way', () => {
    mermaidMock.mockReturnValue(new Promise(() => {}))
    render(<DiagramBlock engine="mermaid" language="mermaid" source="flowchart TD" style="clean" />)
    expect(screen.getByRole('status')).toHaveTextContent('Sketching the diagram')
  })

  it('shows the source as code while streaming, and never tries to draw', async () => {
    const { rerender } = render(
      <DiagramBlock engine="mermaid" language="mermaid" source="flowchart TD\n  A --" style="clean" streaming />,
    )
    expect(screen.getByTestId('code-block')).toHaveTextContent('flowchart TD')
    // Give any stray frame a chance to fire.
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(mermaidMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/pen has blotted/)).not.toBeInTheDocument()

    rerender(<DiagramBlock engine="mermaid" language="mermaid" source="flowchart TD\n  A --> B" style="clean" />)
    await waitFor(() => expect(screen.getByTestId('drawn')).toBeInTheDocument())
    expect(mermaidMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the code block, a note and the engine\'s message on failure', async () => {
    mermaidMock.mockRejectedValue(new Error('Parse error on line 2'))
    render(<DiagramBlock engine="mermaid" language="mermaid" source="flowchart TD\n  A[[[" style="clean" />)
    await waitFor(() => expect(screen.getByText(/pen has blotted/)).toBeInTheDocument())
    expect(screen.getByTestId('code-block')).toHaveTextContent('A[[[')
    expect(screen.getByText('Parse error on line 2')).toBeInTheDocument()
    expect(screen.queryByTestId('drawn')).not.toBeInTheDocument()
  })

  it('toggles the source under the drawing', async () => {
    render(<DiagramBlock engine="mermaid" language="mermaid" source="flowchart TD" style="clean" />)
    await waitFor(() => expect(screen.getByTestId('drawn')).toBeInTheDocument())
    expect(screen.queryByTestId('code-block')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /view source/i }))
    expect(screen.getByTestId('code-block')).toHaveTextContent('flowchart TD')
    fireEvent.click(screen.getByRole('button', { name: /hide source/i }))
    expect(screen.queryByTestId('code-block')).not.toBeInTheDocument()
  })

  it('copies the source and the SVG', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<DiagramBlock engine="mermaid" language="mermaid" source="flowchart TD" style="clean" />)
    await waitFor(() => expect(screen.getByTestId('drawn')).toBeInTheDocument())

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /copy source/i })) })
    expect(writeText).toHaveBeenLastCalledWith('flowchart TD')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /copy svg/i })) })
    expect(writeText).toHaveBeenLastCalledWith(SVG)
  })

  it('downloads the SVG as <engine>-diagram.svg', async () => {
    const createObjectURL = jest.fn(() => 'blob:diagram')
    const revokeObjectURL = jest.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const clicked: string[] = []
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    })
    render(<DiagramBlock engine="graphviz" language="dot" source="digraph {}" style="clean" />)
    await waitFor(() => expect(screen.getByTestId('drawn')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /download svg/i }))
    expect(createObjectURL).toHaveBeenCalled()
    expect(clicked).toEqual(['graphviz-diagram.svg'])
    click.mockRestore()
  })

  it('re-uses a finished drawing when the same diagram mounts again', async () => {
    const first = render(<DiagramBlock engine="mermaid" language="mermaid" source="flowchart LR" style="clean" />)
    await waitFor(() => expect(screen.getByTestId('drawn')).toBeInTheDocument())
    first.unmount()

    render(<DiagramBlock engine="mermaid" language="mermaid" source="flowchart LR" style="clean" />)
    // Drawn on the first paint — no placeholder, no second render.
    expect(screen.getByTestId('drawn')).toBeInTheDocument()
    expect(mermaidMock).toHaveBeenCalledTimes(1)
  })

  it('draws again when the style changes', async () => {
    const { rerender } = render(<DiagramBlock engine="mermaid" language="mermaid" source="flowchart LR" style="clean" />)
    await waitFor(() => expect(mermaidMock).toHaveBeenCalledTimes(1))
    rerender(<DiagramBlock engine="mermaid" language="mermaid" source="flowchart LR" style="handDrawn" />)
    await waitFor(() => expect(mermaidMock).toHaveBeenCalledTimes(2))
    expect(mermaidMock).toHaveBeenLastCalledWith('flowchart LR', expect.objectContaining({ style: 'handDrawn' }))
  })

  it('stays visible with Salon Images quick-hide on', async () => {
    render(
      <ImagesHiddenProvider hidden>
        <DiagramBlock engine="svg" language="svg" source="<svg/>" style="clean" />
      </ImagesHiddenProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('drawn')).toBeInTheDocument())
    expect(document.querySelector('.qt-diagram img')).toBeNull()
  })
})
