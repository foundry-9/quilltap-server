'use client'

/**
 * FilePreviewPdf Component
 *
 * Renders a PDF file using PDF.js for client-side rendering.
 * This approach bypasses Chrome's PDF plugin security restrictions
 * that block embedding PDFs in iframes/objects.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { FilePreviewRendererProps } from './types'

// PDF.js types
interface PDFDocumentProxy {
  numPages: number
  getPage(pageNumber: number): Promise<PDFPageProxy>
}

interface PDFPageProxy {
  getViewport(options: { scale: number }): PDFPageViewport
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PDFPageViewport }): { promise: Promise<void> }
}

interface PDFPageViewport {
  width: number
  height: number
}

export default function FilePreviewPdf({
  file,
  fileUrl,
}: Readonly<FilePreviewRendererProps>) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // PDF.js renderer mounted
  }, [file.id])

  // Load PDF.js and the document
  useEffect(() => {
    let cancelled = false

    async function loadPdf() {
      try {
        setIsLoading(true)
        setError(null)

        // Dynamically import PDF.js
        const pdfjs = await import('pdfjs-dist')

        // Use local worker file (copied from node_modules to public)
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs'

        // Fetch PDF with credentials (for authenticated API routes)
        const response = await fetch(fileUrl, { credentials: 'include' })
        if (!response.ok) {
          throw new Error(`Failed to fetch PDF: ${response.status}`)
        }

        const arrayBuffer = await response.arrayBuffer()

        // Load the PDF document from ArrayBuffer
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer })
        const pdf = await loadingTask.promise

        if (cancelled) return

        pdfDocRef.current = pdf as unknown as PDFDocumentProxy
        setNumPages(pdf.numPages)
        setCurrentPage(1)
      } catch (err) {
        if (cancelled) return
        // Use warn instead of error - this is handled gracefully via error state
        console.warn('[FilePreviewPdf] Failed to load PDF', {
          fileId: file.id,
          error: err instanceof Error ? err.message : String(err),
          errorType: err?.constructor?.name || typeof err,
        })
        setError('Failed to load PDF. Try downloading instead.')
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadPdf()

    return () => {
      cancelled = true
    }
  }, [fileUrl, file.id])

  // Render the current page
  useEffect(() => {
    async function renderPage() {
      const pdf = pdfDocRef.current
      const canvas = canvasRef.current

      if (!pdf || !canvas || currentPage < 1 || currentPage > numPages) {
        return
      }

      try {
        const page = await pdf.getPage(currentPage)
        const viewport = page.getViewport({ scale })

        // Set canvas dimensions
        canvas.width = viewport.width
        canvas.height = viewport.height

        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('Could not get canvas context')
        }

        // Render the page
        await page.render({
          canvasContext: context,
          viewport,
        }).promise
      } catch (err) {
        // Use warn instead of error - page rendering failures are handled gracefully
        console.warn('[FilePreviewPdf] Failed to render page', {
          fileId: file.id,
          page: currentPage,
          error: err instanceof Error ? err.message : String(err),
          errorType: err?.constructor?.name || typeof err,
        })
      }
    }

    renderPage()
  }, [currentPage, numPages, scale, file.id])

  // Calculate initial scale to fit width
  useEffect(() => {
    async function calculateInitialScale() {
      const pdf = pdfDocRef.current
      const container = containerRef.current

      if (!pdf || !container || numPages === 0) return

      try {
        const page = await pdf.getPage(1)
        const viewport = page.getViewport({ scale: 1.0 })
        const containerWidth = container.clientWidth - 40 // Padding
        const newScale = Math.min(containerWidth / viewport.width, 2.0)
        setScale(newScale)
      } catch {
        // Use default scale
      }
    }

    calculateInitialScale()
  }, [numPages])

  const goToPreviousPage = useCallback(() => {
    setCurrentPage((prev) => Math.max(1, prev - 1))
  }, [])

  const goToNextPage = useCallback(() => {
    setCurrentPage((prev) => Math.min(numPages, prev + 1))
  }, [numPages])

  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.25, 3.0))
  }, [])

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.25, 0.5))
  }, [])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px] text-center text-muted-foreground">
        <div className="text-4xl mb-2">{'\u{1F4C4}'}</div>
        <p>{error}</p>
        <a
          href={fileUrl}
          download={file.originalFilename || file.filename}
          className="qt-button qt-button-primary mt-4 inline-block"
        >
          Download PDF
        </a>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center w-full h-full min-h-[400px]"
    >
      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <div className="animate-pulse text-muted-foreground">Loading PDF...</div>
        </div>
      )}

      {!isLoading && numPages > 0 && (
        <>
          {/* Controls */}
          <div className="flex items-center gap-4 mb-4 p-2 bg-surface-secondary rounded">
            {/* Page navigation */}
            <div className="flex items-center gap-2">
              <button
                onClick={goToPreviousPage}
                disabled={currentPage <= 1}
                className="qt-button qt-button-secondary px-2 py-1 disabled:opacity-50"
                aria-label="Previous page"
              >
                {'\u2190'}
              </button>
              <span className="text-sm text-muted-foreground min-w-[80px] text-center">
                {currentPage} / {numPages}
              </span>
              <button
                onClick={goToNextPage}
                disabled={currentPage >= numPages}
                className="qt-button qt-button-secondary px-2 py-1 disabled:opacity-50"
                aria-label="Next page"
              >
                {'\u2192'}
              </button>
            </div>

            {/* Zoom controls */}
            <div className="flex items-center gap-2 border-l border-border pl-4">
              <button
                onClick={zoomOut}
                disabled={scale <= 0.5}
                className="qt-button qt-button-secondary px-2 py-1 disabled:opacity-50"
                aria-label="Zoom out"
              >
                -
              </button>
              <span className="text-sm text-muted-foreground min-w-[50px] text-center">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={zoomIn}
                disabled={scale >= 3.0}
                className="qt-button qt-button-secondary px-2 py-1 disabled:opacity-50"
                aria-label="Zoom in"
              >
                +
              </button>
            </div>

            {/* Download link */}
            <a
              href={fileUrl}
              download={file.originalFilename || file.filename}
              className="qt-button qt-button-secondary px-2 py-1 ml-auto"
            >
              Download
            </a>
          </div>

          {/* Canvas for PDF rendering */}
          <div className="flex-1 overflow-auto flex justify-center">
            <canvas
              ref={canvasRef}
              className="shadow-lg"
            />
          </div>
        </>
      )}
    </div>
  )
}
