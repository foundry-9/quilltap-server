import fs from 'fs/promises';
import mammoth from 'mammoth';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('MountIndex:DocxConverter');

/**
 * Extract plain text from an in-memory DOCX buffer.
 */
export async function convertDocxBufferToText(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) {
    logger.warn('DOCX buffer is empty');
    return '';
  }

  try {
    const result = await mammoth.extractRawText({ buffer });
    if (result.messages.length > 0) {
    }
    return result.value;
  } catch (error) {
    logger.warn('Failed to extract text from DOCX buffer', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Extract plain text from a DOCX file on disk.
 */
export async function convertDocxToText(absolutePath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(absolutePath);
    return await convertDocxBufferToText(buffer);
  } catch (error) {
    logger.warn('Failed to read DOCX from disk', {
      path: absolutePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
