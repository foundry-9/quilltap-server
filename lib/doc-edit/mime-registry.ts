/**
 * MIME Type Registry for Document Editing
 *
 * Provides detection, parsing, and serialization of JSON and JSONL files
 * for the doc_read_file and doc_write_file tools. Also supports YAML for
 * consistency with the file-upload text-detection module.
 *
 * @module doc-edit/mime-registry
 */

import path from 'path';
import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('DocEdit:MimeRegistry');

export type DocMimeType =
  | 'text/markdown'
  | 'text/plain'
  | 'text/json'
  | 'application/json'
  | 'text/x-jsonl'
  | 'application/x-ndjson'
  | 'text/yaml'
  | 'application/yaml';

/**
 * Map file extension (with or without leading dot) to a canonical MIME.
 */
export function detectMimeFromExtension(filePath: string): DocMimeType | null {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.json':
      return 'application/json';
    case '.jsonl':
    case '.ndjson':
      return 'application/x-ndjson';
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.txt':
      return 'text/plain';
    case '.yaml':
    case '.yml':
      return 'application/yaml';
    default:
      return null;
  }
}

/**
 * Check if MIME type is one of the JSON variants
 */
export function isJsonMime(mime: string | null | undefined): boolean {
  return mime === 'text/json' || mime === 'application/json';
}

/**
 * Check if MIME type is one of the JSONL variants
 */
export function isJsonlMime(mime: string | null | undefined): boolean {
  return mime === 'text/x-jsonl' || mime === 'application/x-ndjson';
}

/**
 * Check if MIME type is JSON or JSONL
 */
export function isJsonFamily(mime: string | null | undefined): boolean {
  return isJsonMime(mime) || isJsonlMime(mime);
}

// ============================================================================
// Parsing and Serialization
// ============================================================================

export interface ParseSuccess<T = unknown> {
  ok: true;
  value: T;
}

export interface ParseFailure {
  ok: false;
  error: string;
  line?: number;
}

export type ParseResult<T = unknown> = ParseSuccess<T> | ParseFailure;

/**
 * Result of parsing a single JSONL line.
 * line: 1-based line number
 * value: parsed value if successful
 * error: error message if parsing failed
 * raw: the original line string
 */
export interface JsonlLineResult {
  line: number;
  value?: unknown;
  error?: string;
  raw: string;
}

/**
 * Parse content into a native value.
 * - JSON: single JSON.parse. On failure, ok=false with the parser message.
 * - JSONL: per-line parse. Returns { ok: true, value: Array<LineResult> } always —
 *   per-line failures are captured in the array entries, not a top-level failure.
 *   Empty / whitespace-only lines are skipped (not included in the array).
 */
export function parseContent(content: string, mime: DocMimeType): ParseResult {
  if (isJsonMime(mime)) {
    try {
      const value = JSON.parse(content);
      return { ok: true, value };
    } catch (error) {
      const message = error instanceof SyntaxError ? error.message : String(error);
      return { ok: false, error: message };
    }
  }

  if (isJsonlMime(mime)) {
    const lines = content.split(/\r?\n/);
    const results: JsonlLineResult[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Skip empty or whitespace-only lines
      if (!line.trim()) {
        continue;
      }

      try {
        const value = JSON.parse(line);
        results.push({ line: lineNum, value, raw: line });
      } catch (error) {
        const message = error instanceof SyntaxError ? error.message : String(error);
        results.push({ line: lineNum, error: message, raw: line });
      }
    }
    return { ok: true, value: results };
  }

  // Non-JSON MIME types are never parsed
  return { ok: false, error: `MIME type ${mime} is not supported for parsing` };
}

/**
 * Serialize a native value for storage.
 * - JSON: JSON.stringify(value, null, 2) with a trailing newline.
 * - JSONL: value must be an array; each entry becomes one line; trailing newline.
 * - If `value` is already a string, it is returned as-is unless `validateString` is true,
 *   in which case it is parsed and reserialized canonically.
 *
 * Throws (via return-shape) on non-serializable input.
 */
export interface SerialiseOptions {
  validateString?: boolean;
  pretty?: boolean;
}

export function serializeContent(
  value: unknown,
  mime: DocMimeType,
  opts?: SerialiseOptions
): ParseResult<string> {
  const pretty = opts?.pretty !== false;
  const validate = opts?.validateString || false;

  // If input is a string, validate it if requested, otherwise return as-is
  if (typeof value === 'string') {
    if (!validate) {
      return { ok: true, value };
    }

    // Validate by parsing and reserializing
    const parseResult = parseContent(value, mime);
    if (!parseResult.ok) {
      return parseResult;
    }
    // Fall through to serialize the parsed value
    value = parseResult.value;
  }

  try {
    if (isJsonMime(mime)) {
      const serialized = JSON.stringify(value, null, pretty ? 2 : undefined) + '\n';
      return { ok: true, value: serialized };
    }

    if (isJsonlMime(mime)) {
      if (!Array.isArray(value)) {
        return {
          ok: false,
          error: 'JSONL requires an array value; got ' + typeof value,
        };
      }

      const lines: string[] = [];
      for (const item of value) {
        lines.push(JSON.stringify(item));
      }
      const serialized = lines.join('\n') + (lines.length > 0 ? '\n' : '');
      return { ok: true, value: serialized };
    }

    return { ok: false, error: `MIME type ${mime} is not supported for serialization` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Cannot serialize content: ${message}` };
  }
}

/**
 * Validate a raw string parses as JSON (for the single-value case) or JSONL (all lines parse).
 * Returns ok: true if valid, ok: false with error message if invalid.
 */
export function validateJson(content: string, mime: DocMimeType): ParseResult<true> {
  if (isJsonMime(mime)) {
    try {
      JSON.parse(content);
      return { ok: true, value: true };
    } catch (error) {
      const message = error instanceof SyntaxError ? error.message : String(error);
      return { ok: false, error: message };
    }
  }

  if (isJsonlMime(mime)) {
    const lines = content.split(/\r?\n/).filter(line => line.trim());

    for (let i = 0; i < lines.length; i++) {
      try {
        JSON.parse(lines[i]);
      } catch (error) {
        const message = error instanceof SyntaxError ? error.message : String(error);
        return { ok: false, error: `Line ${i + 1}: ${message}` };
      }
    }
    return { ok: true, value: true };
  }

  return { ok: false, error: `MIME type ${mime} does not support JSON validation` };
}
