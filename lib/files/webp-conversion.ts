/**
 * WebP Conversion Utility
 *
 * Converts image buffers to WebP format for consistent, space-efficient storage.
 * SVG images are passed through unchanged since they are vector graphics.
 * All other raster image formats (PNG, JPEG, GIF, AVIF) are converted to WebP.
 *
 * @module lib/files/webp-conversion
 */

import { createLogger } from '@/lib/logging/create-logger';

const logger = createLogger('files:webp-conversion');

/** WebP quality setting (1-100). 90 gives excellent quality with good compression. */
const WEBP_QUALITY = 90;

/** MIME types that should NOT be converted (pass through unchanged) */
const PASSTHROUGH_MIME_TYPES = new Set([
  'image/svg+xml',
  'image/webp',
]);

/** MIME types that can be converted to WebP */
const CONVERTIBLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/avif',
]);

export interface WebPConversionResult {
  /** The (possibly converted) image buffer */
  buffer: Buffer;
  /** The output MIME type */
  mimeType: string;
  /** The output filename (extension updated to .webp if converted) */
  filename: string;
  /** Whether conversion actually happened */
  wasConverted: boolean;
}

/**
 * Check if a MIME type needs WebP conversion.
 *
 * Returns true for raster image types that should be converted.
 * Returns false for SVG, WebP (already target format), and non-image types.
 */
export function needsWebPConversion(mimeType: string): boolean {
  return CONVERTIBLE_MIME_TYPES.has(mimeType);
}

/**
 * Replace the file extension in a filename with .webp.
 *
 * If the filename has no extension, appends .webp.
 */
function replaceExtensionWithWebP(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex > 0) {
    return `${filename.slice(0, dotIndex)}.webp`;
  }
  return `${filename}.webp`;
}

/**
 * Convert an image buffer to WebP format.
 *
 * - SVG images pass through unchanged (vector format, no conversion needed).
 * - Images already in WebP format pass through unchanged.
 * - All other raster images (PNG, JPEG, GIF, AVIF) are converted to WebP.
 * - Non-image MIME types pass through unchanged.
 *
 * If conversion fails, the original buffer is returned with a warning logged.
 *
 * @param buffer - The image bytes
 * @param mimeType - The current MIME type of the image
 * @param filename - The current filename
 * @returns The conversion result with (possibly updated) buffer, mimeType, and filename
 */
export async function convertToWebP(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<WebPConversionResult> {
  // Pass through non-convertible types
  if (!needsWebPConversion(mimeType)) {
    return { buffer, mimeType, filename, wasConverted: false };
  }

  try {
    const sharp = (await import('sharp')).default;
    const originalSize = buffer.length;

    const webpBuffer = await sharp(buffer)
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    const newFilename = replaceExtensionWithWebP(filename);

    return {
      buffer: webpBuffer,
      mimeType: 'image/webp',
      filename: newFilename,
      wasConverted: true,
    };
  } catch (error) {
    logger.warn('WebP conversion failed, keeping original format', {
      context: 'files.webp-conversion',
      mimeType,
      filename,
      error: error instanceof Error ? error.message : String(error),
    });

    return { buffer, mimeType, filename, wasConverted: false };
  }
}
