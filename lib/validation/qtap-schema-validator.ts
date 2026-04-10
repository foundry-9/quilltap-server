/**
 * Quilltap Export Schema Validator
 *
 * Validates objects against the .qtap export JSON Schema using Ajv.
 * Used by the AI import service and can also improve regular .qtap import validation.
 */

import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '@/lib/logger';

// ============================================================================
// Types
// ============================================================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// Schema Loading
// ============================================================================

let cachedSchema: object | null = null;

/**
 * Load the qtap-export schema from the public/schemas directory.
 * Caches the schema after first load.
 */
function loadSchema(): object {
  if (cachedSchema) {
    return cachedSchema;
  }

  try {
    const schemaPath = join(process.cwd(), 'public', 'schemas', 'qtap-export.schema.json');
    const schemaText = readFileSync(schemaPath, 'utf-8');
    cachedSchema = JSON.parse(schemaText);
    return cachedSchema!;
  } catch (error) {
    logger.error('[QtapSchemaValidator] Failed to load schema', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`Failed to load qtap-export schema: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============================================================================
// Validator
// ============================================================================

let cachedValidator: ReturnType<Ajv2020['compile']> | null = null;

/**
 * Get or create the compiled Ajv validator.
 * Caches the compiled validator after first compilation.
 */
function getValidator(): ReturnType<Ajv2020['compile']> {
  if (cachedValidator) {
    return cachedValidator;
  }

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);

  const schema = loadSchema();
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

/**
 * Validate an object against the .qtap export schema.
 *
 * @param data - The object to validate
 * @returns Validation result with errors if invalid
 */
export function validateQtapExport(data: unknown): ValidationResult {
  try {
    const validate = getValidator();
    const valid = validate(data);

    if (valid) {
      return { valid: true, errors: [] };
    }

    const errors = (validate.errors || []).map((err) => {
      const path = err.instancePath || '/';
      const message = err.message || 'unknown error';
      return `${path}: ${message}`;
    });

    return { valid: false, errors };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[QtapSchemaValidator] Validation error', { error: errorMessage });
    return { valid: false, errors: [`Schema validation error: ${errorMessage}`] };
  }
}

/**
 * Reset the cached validator and schema.
 * Useful for testing or when the schema file changes.
 */
export function resetValidatorCache(): void {
  cachedSchema = null;
  cachedValidator = null;
}
