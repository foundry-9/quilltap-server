import fs from 'fs/promises';
import mammoth from 'mammoth';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:DocxConverter');

/**
 * Extract plain text from a DOCX file.
 *
 * Returns an empty string (with a warning log) if the file is missing,
 * unreadable, or corrupted.
 */
export async function convertDocxToText(absolutePath: string): Promise<string> {
  logger.debug('Converting DOCX to text', { path: absolutePath });

  try {
    const buffer = await fs.readFile(absolutePath);

    if (buffer.length === 0) {
      logger.warn('DOCX file is empty', { path: absolutePath });
      return '';
    }

    const result = await mammoth.extractRawText({ buffer });

    if (result.messages.length > 0) {
      logger.debug('Mammoth conversion messages', {
        path: absolutePath,
        messages: result.messages.map((m) => m.message),
      });
    }

    logger.debug('DOCX conversion complete', {
      path: absolutePath,
      textLength: result.value.length,
    });

    return result.value;
  } catch (error) {
    logger.warn('Failed to extract text from DOCX', {
      path: absolutePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
