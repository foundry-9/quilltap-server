import fs from 'fs/promises';

/**
 * Read a plain-text file and return its contents.
 *
 * Returns an empty string if the file cannot be read (missing, permissions,
 * or binary content that fails UTF-8 decoding).
 */
export async function convertTxtToText(absolutePath: string): Promise<string> {
  try {
    return await fs.readFile(absolutePath, 'utf-8');
  } catch {
    return '';
  }
}
