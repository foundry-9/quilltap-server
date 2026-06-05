/**
 * Parse + validate a Quilltap export file before any import work begins.
 *
 * @module import/quilltap-import/validation
 */

import { logger } from '@/lib/logger';
import type { QuilltapExport } from '@/lib/export/types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/**
 * Parses a JSON string as a QuilltapExport
 */
export function parseExportFile(jsonString: string): QuilltapExport {
  try {
    const data = JSON.parse(jsonString);
    validateExportFormat(data);
    return data;
  } catch (error) {
    moduleLogger.error('Failed to parse export file', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Invalid export file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validates that data conforms to QuilltapExport schema
 */
export function validateExportFormat(data: unknown): asserts data is QuilltapExport {
  if (!data || typeof data !== 'object') {
    throw new Error('Export data must be a JSON object');
  }

  const obj = data as Record<string, unknown>;

  // Validate manifest exists
  if (!obj.manifest || typeof obj.manifest !== 'object') {
    throw new Error('Missing or invalid manifest');
  }

  const manifest = obj.manifest as Record<string, unknown>;

  // Validate manifest format
  if (manifest.format !== 'quilltap-export') {
    throw new Error(
      `Invalid format: expected 'quilltap-export', got '${manifest.format}'`
    );
  }

  // Validate version
  if (manifest.version !== '1.0') {
    throw new Error(
      `Unsupported version: ${manifest.version}. Only 1.0 is supported.`
    );
  }

  // Validate data exists
  if (!obj.data || typeof obj.data !== 'object') {
    throw new Error('Missing or invalid data section');
  }
}
