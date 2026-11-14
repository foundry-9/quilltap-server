/**
 * API keys — the request-body shapes for `/api/v1/api-keys` (create, export,
 * import, import-preview) and `/api/v1/api-keys/[id]` (update, test).
 *
 * The routes used to check each field by hand. A malformed body is now a
 * ZodError, which the middleware answers with a 400 whose `message` names the
 * field; the messages are the ones the routes always used.
 *
 * @module api-keys/api-key-input
 */

import { z } from 'zod';

/** The `format` an export file carries. */
export const API_KEY_EXPORT_FORMAT = 'quilltap-apikeys';
/** The version this server writes. */
export const API_KEY_EXPORT_VERSION = 1;
/** Every version this server reads. */
export const API_KEY_SUPPORTED_VERSIONS: readonly number[] = [1];
/** The shortest passphrase an export may be sealed with. */
export const MIN_API_KEY_PASSPHRASE_LENGTH = 8;

const nonBlank = (message: string) => z.string({ error: message }).refine((v) => v.trim().length > 0, { message });

/** POST body. The key itself is stored exactly as sent. */
export const ApiKeyCreateSchema = z
  .object({
    provider: nonBlank('Invalid provider').transform((v) => v.trim()),
    label: nonBlank('Label is required').transform((v) => v.trim()),
    apiKey: nonBlank('API key is required'),
  })
  .strict();

/** PUT body: any subset. */
export const ApiKeyUpdateSchema = z
  .object({
    label: nonBlank('Label must be a non-empty string').transform((v) => v.trim()),
    isActive: z.boolean({ error: 'isActive must be a boolean' }),
    apiKey: nonBlank('API key must be a non-empty string'),
  })
  .partial()
  .strict();

/** `?action=test` body: an optional base URL for providers that need one. */
export const ApiKeyTestSchema = z.object({
  baseUrl: z.string().optional(),
});

/** `?action=export` body. */
export const ApiKeyExportSchema = z.object({
  passphrase: z
    .string({ error: 'Passphrase is required' })
    .min(MIN_API_KEY_PASSPHRASE_LENGTH, `Passphrase must be at least ${MIN_API_KEY_PASSPHRASE_LENGTH} characters`),
});

/**
 * An export file, as `?action=export` writes it. Extra keys are tolerated —
 * the file is a document the user carries around, not a request we shaped.
 */
export const ApiKeyExportFileSchema = z.object(
  {
    format: z.literal(API_KEY_EXPORT_FORMAT, { error: 'Invalid file format' }),
    version: z.number().refine((v) => API_KEY_SUPPORTED_VERSIONS.includes(v), {
      error: (issue) => `Unsupported file version: ${String(issue.input)}`,
    }),
    encryption: z.object(
      {
        salt: z.string().min(1, 'Invalid file structure'),
        // Files written before the iteration count was raised carry none.
        kdfIterations: z.number().int().positive().optional(),
      },
      { error: 'Invalid file structure' },
    ),
    payload: z.object(
      {
        ciphertext: z.string().min(1, 'Invalid file structure'),
        iv: z.string().min(1, 'Invalid file structure'),
        authTag: z.string().min(1, 'Invalid file structure'),
      },
      { error: 'Invalid file structure' },
    ),
    signature: z.string().default(''),
  },
  { error: 'Import file is required' },
);

export type ApiKeyExportFile = z.infer<typeof ApiKeyExportFileSchema>;

/** `?action=import-preview` body. */
export const ApiKeyImportPreviewSchema = z.object({
  file: ApiKeyExportFileSchema,
  passphrase: z.string({ error: 'Passphrase is required' }).min(1, 'Passphrase is required'),
});

/** `?action=import` body. */
export const ApiKeyImportSchema = ApiKeyImportPreviewSchema.extend({
  duplicateHandling: z.enum(['skip', 'replace', 'rename'], { error: 'Invalid duplicate handling option' }).default('skip'),
});

/** The decrypted payload of an export file. A malformed key entry is reported per key, not refused whole. */
export const ApiKeyExportPayloadSchema = z.object(
  { keys: z.array(z.object({ provider: z.string(), label: z.string(), apiKey: z.string() }).partial()) },
  { error: 'Invalid payload structure' },
);
