import { createServiceLogger } from '@/lib/logging/create-logger';
import { convertPdfToText } from './pdf-converter';
import { convertDocxToText } from './docx-converter';
import { convertMarkdownToText } from './markdown-converter';
import { convertTxtToText } from './txt-converter';

const logger = createServiceLogger('MountIndex:Converters');

export type SupportedFileType = 'pdf' | 'docx' | 'markdown' | 'txt';

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
  logger.debug('Starting conversion', { path: absolutePath, fileType });

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
    default: {
      const exhaustive: never = fileType;
      logger.warn('Unsupported file type', { path: absolutePath, fileType: exhaustive });
      return '';
    }
  }

  logger.debug('Conversion complete', {
    path: absolutePath,
    fileType,
    resultLength: text.length,
  });

  return text;
}

export { convertPdfToText } from './pdf-converter';
export { convertDocxToText } from './docx-converter';
export { convertMarkdownToText } from './markdown-converter';
export { convertTxtToText } from './txt-converter';
