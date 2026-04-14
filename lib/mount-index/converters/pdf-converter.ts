import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:PdfConverter');

/**
 * Extract plain text from a PDF file.
 *
 * Returns an empty string (with a warning log) if the file is missing,
 * unreadable, or contains no extractable text.
 */
export async function convertPdfToText(absolutePath: string): Promise<string> {
  logger.debug('Converting PDF to text', { path: absolutePath });

  try {
    const buffer = await fs.readFile(absolutePath);

    if (buffer.length === 0) {
      logger.warn('PDF file is empty', { path: absolutePath });
      return '';
    }

    // pdf-parse v2 uses the PDFParse class with LoadParameters
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    try {
      const result = await parser.getText();

      logger.debug('PDF conversion complete', {
        path: absolutePath,
        pages: result.total,
        textLength: result.text.length,
      });

      return result.text;
    } finally {
      await parser.destroy().catch(() => {
        // Ignore cleanup errors
      });
    }
  } catch (error) {
    logger.warn('Failed to extract text from PDF', {
      path: absolutePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
