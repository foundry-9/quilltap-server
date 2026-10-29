import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:PdfConverter');

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>['getPage']>>;

/**
 * Layout thresholds, in PDF points. These are pdf-parse 2.x's defaults: we
 * extracted through it until pdfjs-dist 6, and keeping its assembly keeps
 * already-indexed documents byte-stable on re-index.
 */
const LINE_THRESHOLD = 4.6;
const CELL_THRESHOLD = 7;
const CELL_SEPARATOR = '\t';

/**
 * Join one page's text items into lines. A vertical jump larger than the
 * tallest glyph on the current line starts a new line; a horizontal gap on
 * the same line becomes a tab (table cells).
 */
async function extractPageText(page: PdfPage): Promise<string> {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  const parts: string[] = [];
  let lastX: number | undefined;
  let lastY: number | undefined;
  let lineHeight = 0;

  for (const item of textContent.items) {
    if (!('str' in item)) continue;

    let str = item.str;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);

    if (lastY !== undefined) {
      const yDiff = Math.abs(lastY - y);
      if (yDiff > LINE_THRESHOLD) {
        const lastPart = parts[parts.length - 1];
        const startsOwnLine = str.startsWith('\n') || (str.trim() === '' && item.hasEOL);
        if (lastPart !== undefined && !lastPart.endsWith('\n') && !startsOwnLine && yDiff - 1 > lineHeight) {
          parts.push('\n');
          lineHeight = 0;
        }
      } else if (yDiff < LINE_THRESHOLD && lastX !== undefined && Math.abs(lastX - x) > CELL_THRESHOLD) {
        str = `${CELL_SEPARATOR}${str}`;
      }
    }

    parts.push(str);
    lastX = x + item.width;
    lastY = y;
    lineHeight = Math.max(lineHeight, item.height);
    if (item.hasEOL) parts.push('\n');
    if (item.hasEOL || str.endsWith('\n')) lineHeight = 0;
  }

  return parts.join('');
}

/**
 * Extract plain text from an in-memory PDF buffer.
 *
 * Text only: no rendering, annotations, XFA forms or embedded scripts.
 * Returns an empty string (with a warning log) on any failure.
 */
export async function convertPdfBufferToText(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) {
    logger.warn('PDF buffer is empty');
    return '';
  }

  let loadingTask: ReturnType<PdfjsModule['getDocument']> | undefined;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    loadingTask = pdfjs.getDocument({
      // pdfjs transfers (detaches) the buffer it is given, so hand it a copy
      data: new Uint8Array(buffer),
      enableXfa: false,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });
    const doc = await loadingTask.promise;

    let text = '';
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const pageText = await extractPageText(page);
        text += `${pageText}\n\n-- ${pageNumber} of ${doc.numPages} --\n\n`;
      } finally {
        page.cleanup();
      }
    }

    logger.debug('Extracted PDF text', { pages: doc.numPages, chars: text.length });
    return text;
  } catch (error) {
    logger.warn('Failed to extract text from PDF buffer', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  } finally {
    await loadingTask?.destroy().catch(() => {
      // Ignore cleanup errors
    });
  }
}

/**
 * Extract plain text from a PDF file on disk.
 */
export async function convertPdfToText(absolutePath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(absolutePath);
    return await convertPdfBufferToText(buffer);
  } catch (error) {
    logger.warn('Failed to read PDF from disk', {
      path: absolutePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
