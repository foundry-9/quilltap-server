import { createServiceLogger } from '@/lib/logging/create-logger';
import { convertPdfToText, convertPdfBufferToText } from './pdf-converter';
import { convertDocxToText, convertDocxBufferToText } from './docx-converter';
import { convertMarkdownToText } from './markdown-converter';
import { convertTxtToText } from './txt-converter';

const logger = createServiceLogger('MountIndex:Converters');

export type SupportedFileType = 'pdf' | 'docx' | 'markdown' | 'txt' | 'json' | 'jsonl';

/**
 * Convert a file to plain text using the appropriate converter for its type.
 *
 * @param absolutePath - Absolute filesystem path to the source file
 * @param fileType     - The logical file type to select the converter
 * @returns The extracted plain text, or an empty string on failure
 */
export async function convertToPlainText(
  absolutePath: string,
  fileType: SupportedFileType,
): Promise<string> {

  let text: string;

  switch (fileType) {
    case 'pdf':
      text = await convertPdfToText(absolutePath);
      break;
    case 'docx':
      text = await convertDocxToText(absolutePath);
      break;
    case 'markdown':
      text = await convertMarkdownToText(absolutePath);
      break;
    case 'txt':
      text = await convertTxtToText(absolutePath);
      break;
    case 'json':
    case 'jsonl':
      // JSON files are already plain text; just read as-is (pretty-printed if possible)
      text = await convertTxtToText(absolutePath);
      break;
    default: {
      const exhaustive: never = fileType;
      logger.warn('Unsupported file type', { path: absolutePath, fileType: exhaustive });
      return '';
    }
  }

  return text;
}

/**
 * Convert an in-memory buffer to plain text. Used by the Scriptorium blob
 * pipeline: we never write uploaded PDFs/DOCX to disk, so the converters
 * that need them must accept a Buffer directly.
 *
 * Returns an empty string if the file type has no extractable text (images,
 * arbitrary binaries). Callers should treat an empty result as "no text
 * representation available" rather than a failure.
 */
export async function convertBufferToPlainText(
  buffer: Buffer,
  fileType: SupportedFileType,
): Promise<string> {
  switch (fileType) {
    case 'pdf':
      return convertPdfBufferToText(buffer);
    case 'docx':
      return convertDocxBufferToText(buffer);
    case 'markdown':
    case 'txt':
    case 'json':
    case 'jsonl':
      // Text formats: assume UTF-8. Matches the txt-converter's read-and-return
      // behaviour for the filesystem path.
      return buffer.toString('utf-8');
    default: {
      const exhaustive: never = fileType;
      logger.warn('Unsupported file type for buffer conversion', { fileType: exhaustive });
      return '';
    }
  }
}

export { convertPdfToText, convertPdfBufferToText } from './pdf-converter';
export { convertDocxToText, convertDocxBufferToText } from './docx-converter';
export { convertMarkdownToText } from './markdown-converter';
export { convertTxtToText } from './txt-converter';
