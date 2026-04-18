import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:PdfConverter');

/**
 * Extract plain text from an in-memory PDF buffer.
 *
 * Returns an empty string (with a warning log) on any failure.
 */
export async function convertPdfBufferToText(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) {
    logger.warn('PDF buffer is empty');
    return '';
  }

  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    try {
      const result = await parser.getText();
      logger.debug('PDF conversion complete', {
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
    logger.warn('Failed to extract text from PDF buffer', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Extract plain text from a PDF file on disk.
 */
export async function convertPdfToText(absolutePath: string): Promise<string> {
  logger.debug('Converting PDF to text', { path: absolutePath });
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
