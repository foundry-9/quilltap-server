/**
 * API Keys API v1 - Collection Endpoint
 *
 * GET /api/v1/api-keys - List all API keys for current user
 * POST /api/v1/api-keys - Create a new API key
 * POST /api/v1/api-keys?action=auto-associate - Trigger auto-association
 * POST /api/v1/api-keys?action=export - Export keys encrypted with passphrase
 * POST /api/v1/api-keys?action=import - Import keys from export file
 * POST /api/v1/api-keys?action=import-preview - Preview import file
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { getUserRepositories } from '@/lib/repositories/factory';
import { maskApiKey, encryptWithPassphrase, decryptWithPassphrase, signWithPassphrase, verifyWithPassphrase } from '@/lib/encryption';
import { Provider } from '@/lib/schemas/types';
import { getAllAvailableProviders } from '@/lib/llm';
import { logger } from '@/lib/logger';
import { autoAssociateApiKeys, autoAssociateAllKeys, type ProfileAssociation } from '@/lib/api-keys/auto-associate';
import { badRequest, serverError, successResponse, created } from '@/lib/api/responses';
import { z } from 'zod';
import {
  API_KEY_EXPORT_FORMAT,
  API_KEY_EXPORT_VERSION,
  ApiKeyCreateSchema,
  ApiKeyExportSchema,
  ApiKeyImportSchema,
  ApiKeyImportPreviewSchema,
  ApiKeyExportPayloadSchema,
  type ApiKeyExportFile,
} from '@/lib/api-keys/api-key-input';

/** What an export file seals: the plaintext keys. */
interface ExportPayload {
  keys: Array<{
    provider: string;
    label: string;
    apiKey: string;
  }>;
}

/**
 * Open an export file's payload with the passphrase. Null when the passphrase
 * is wrong, the file is corrupt, or what decrypts is not a key list.
 */
function openExportFile(
  file: ApiKeyExportFile,
  passphrase: string
): z.infer<typeof ApiKeyExportPayloadSchema> | null {
  let decrypted: unknown;
  try {
    decrypted = decryptWithPassphrase<unknown>(
      {
        salt: file.encryption.salt,
        iv: file.payload.iv,
        ciphertext: file.payload.ciphertext,
        authTag: file.payload.authTag,
        iterations: file.encryption.kdfIterations,
      },
      passphrase
    );
  } catch {
    logger.debug('[API Keys v1] Export file did not decrypt');
    return null;
  }
  const parsed = ApiKeyExportPayloadSchema.safeParse(decrypted);
  return parsed.success ? parsed.data : null;
}


/**
 * GET /api/v1/api-keys
 * List all API keys for the authenticated user (masked)
 */
export const GET = createContextHandler(async (req, { user }) => {
  try {

    const repos = getUserRepositories(user.id);
    const apiKeys = await repos.connections.getAllApiKeys();

    // Sort by creation date (newest first)
    const sortedKeys = apiKeys.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Mask the encrypted keys for security
    const maskedKeys = sortedKeys.map((key) => ({
      id: key.id,
      provider: key.provider,
      label: key.label,
      isActive: key.isActive,
      lastUsed: key.lastUsed,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      keyPreview: maskApiKey(key.key_value),
    }));

    const response = NextResponse.json({
      apiKeys: maskedKeys,
      count: maskedKeys.length,
    });
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
  } catch (error) {
    logger.error('[API Keys v1] Error listing keys', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch API keys');
  }
});

/**
 * POST /api/v1/api-keys - Create a new API key (default action)
 */
async function handleCreate(req: NextRequest, user: { id: string }) {
  const { provider, label, apiKey } = ApiKeyCreateSchema.parse(await req.json());

  // Check if provider is registered (warn but allow for future plugins)
  if (!getAllAvailableProviders().includes(provider)) {
    logger.warn('[API Keys v1] Key created for unregistered provider', { provider });
  }

  const repos = getUserRepositories(user.id);
  const newKey = await repos.connections.createApiKey({
    provider: provider as Provider,
    label,
    key_value: apiKey,
    isActive: true,
  });

  // Auto-associate the new key with profiles that need it
  const associationResult = await autoAssociateApiKeys(user.id, [newKey.id]);

  logger.info('[API Keys v1] Key created', {
    keyId: newKey.id,
    provider: newKey.provider,
    associations: associationResult.associations.length,
  });

  return created({
    apiKey: {
      id: newKey.id,
      provider: newKey.provider,
      label: newKey.label,
      isActive: newKey.isActive,
      createdAt: newKey.createdAt,
      updatedAt: newKey.updatedAt,
      associations: associationResult.associations,
    },
  });
}

/**
 * POST /api/v1/api-keys?action=auto-associate
 * Trigger auto-association of API keys with profiles
 */
async function handleAutoAssociate(req: NextRequest, user: { id: string }) {
  try {

    const result = await autoAssociateAllKeys(user.id);

    logger.info('[API Keys v1] Auto-association completed', {
      userId: user.id,
      associations: result.associations.length,
      errors: result.errors.length,
    });

    return successResponse({
      success: true,
      associations: result.associations,
      errors: result.errors,
    });
  } catch (error) {
    logger.error('[API Keys v1] Error in auto-association', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to run auto-association');
  }
}

/**
 * POST /api/v1/api-keys?action=export
 * Export all API keys encrypted with a user-provided passphrase
 */
async function handleExport(req: NextRequest, user: { id: string }) {
  const { passphrase } = ApiKeyExportSchema.parse(await req.json());
  try {

    const repos = getUserRepositories(user.id);
    const apiKeys = await repos.connections.getAllApiKeys();

    if (apiKeys.length === 0) {
      return badRequest('No API keys to export');
    }

    // Build the payload from plaintext keys
    const decryptedKeys: ExportPayload['keys'] = apiKeys.map((key) => ({
      provider: key.provider,
      label: key.label,
      apiKey: key.key_value,
    }));

    const payload: ExportPayload = { keys: decryptedKeys };

    // Encrypt the payload with the passphrase
    const encrypted = encryptWithPassphrase(payload, passphrase);

    // Sign the encrypted payload for integrity verification
    const payloadJson = JSON.stringify({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });
    const signature = signWithPassphrase(payloadJson, passphrase, encrypted.iterations);

    // Build the export file
    const exportFile = {
      format: API_KEY_EXPORT_FORMAT,
      version: API_KEY_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      keyCount: decryptedKeys.length,
      encryption: {
        algorithm: 'aes-256-gcm',
        kdf: 'pbkdf2',
        kdfIterations: encrypted.iterations,
        salt: encrypted.salt,
      },
      payload: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      signature,
    };

    logger.info('[API Keys v1] Export completed', {
      userId: user.id,
      keyCount: decryptedKeys.length,
    });

    return successResponse(exportFile);
  } catch (error) {
    logger.error('[API Keys v1] Error exporting keys', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to export API keys');
  }
}

/**
 * POST /api/v1/api-keys?action=import
 * Import API keys from export file
 */
async function handleImport(req: NextRequest, user: { id: string }) {
  const { file, passphrase, duplicateHandling: handling } = ApiKeyImportSchema.parse(await req.json());
  try {
    const payload = openExportFile(file, passphrase);
    if (!payload) {
      return badRequest('Invalid passphrase or corrupted file');
    }

    const repos = getUserRepositories(user.id);
    const existingKeys = await repos.connections.getAllApiKeys();

    const result = {
      imported: 0,
      skipped: 0,
      replaced: 0,
      errors: [] as string[],
      associations: [] as ProfileAssociation[],
    };

    // Track IDs of newly imported/replaced keys for auto-association
    const newKeyIds: string[] = [];

    for (const key of payload.keys) {
      try {
        // Validate key data
        if (!key.provider || !key.label || !key.apiKey) {
          result.errors.push('Invalid key data: missing required fields');
          continue;
        }

        // Find duplicate by provider + label
        const existing = existingKeys.find(
          (e) => e.provider === key.provider && e.label === key.label
        );

        if (existing) {
          if (handling === 'skip') {
            result.skipped++;
            continue;
          } else if (handling === 'replace') {
            // Update existing key
            await repos.connections.updateApiKey(existing.id, {
              key_value: key.apiKey,
            });
            newKeyIds.push(existing.id);
            result.replaced++;
            continue;
          }
          // For 'rename', fall through to create with modified label
        }

        // Determine label (may be modified for rename)
        let label = key.label;
        if (existing && handling === 'rename') {
          let counter = 1;
          let newLabel = `${key.label} (imported)`;
          while (
            existingKeys.some((e) => e.label === newLabel) ||
            payload.keys.some((k) => k !== key && k.label === newLabel)
          ) {
            counter++;
            newLabel = `${key.label} (imported ${counter})`;
          }
          label = newLabel;
        }

        // Create the new key
        const newKey = await repos.connections.createApiKey({
          provider: key.provider as Provider,
          label,
          key_value: key.apiKey,
          isActive: true,
        });

        newKeyIds.push(newKey.id);
        result.imported++;
      } catch (error) {
        logger.error('[API Keys v1] Failed to import key', {
          provider: key.provider,
          label: key.label,
        }, error instanceof Error ? error : undefined);
        result.errors.push(
          `Failed to import key "${key.label}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // Auto-associate new keys with profiles that need them
    if (newKeyIds.length > 0) {const associationResult = await autoAssociateApiKeys(user.id, newKeyIds);
      result.associations = associationResult.associations;

      if (associationResult.errors.length > 0) {
        result.errors.push(...associationResult.errors);
      }
    }

    logger.info('[API Keys v1] Import completed', {
      userId: user.id,
      imported: result.imported,
      skipped: result.skipped,
      replaced: result.replaced,
      associations: result.associations.length,
      errors: result.errors.length,
    });

    return successResponse(result);
  } catch (error) {
    logger.error('[API Keys v1] Error importing keys', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to import API keys');
  }
}

/**
 * POST /api/v1/api-keys?action=import-preview
 * Preview keys in an import file
 */
async function handleImportPreview(req: NextRequest, user: { id: string }) {
  // A malformed file or passphrase is the middleware's 400; the preview's own
  // `{ valid: false, error }` answers are for a file that is well-formed but
  // will not open.
  const { file: importFile, passphrase } = ApiKeyImportPreviewSchema.parse(await req.json());
  try {
    // Verify signature (warn but don't block if invalid)
    const payloadJson = JSON.stringify({
      ciphertext: importFile.payload.ciphertext,
      iv: importFile.payload.iv,
      authTag: importFile.payload.authTag,
    });
    // Files written before the iteration count was raised carry 100,000.
    const signatureValid = verifyWithPassphrase(
      payloadJson,
      importFile.signature,
      passphrase,
      importFile.encryption.kdfIterations ?? 100_000,
    );

    if (!signatureValid) {
      logger.warn('[API Keys v1] Import file signature verification failed', { userId: user.id });
    }

    const payload = openExportFile(importFile, passphrase);
    if (!payload) {
      return NextResponse.json({ valid: false, error: 'Invalid passphrase or corrupted file' }, { status: 400 });
    }

    // Get existing keys to check for duplicates
    const repos = getUserRepositories(user.id);
    const existingKeys = await repos.connections.getAllApiKeys();

    // Build preview response
    const previewKeys: Array<{
      provider: string;
      label: string;
      keyPreview: string;
      isDuplicate: boolean;
      existingId?: string;
    }> = [];
    let duplicateCount = 0;

    for (const key of payload.keys) {
      const existing = existingKeys.find(
        (e) => e.provider === key.provider && e.label === key.label
      );

      if (existing) {
        duplicateCount++;
      }

      previewKeys.push({
        provider: key.provider ?? '',
        label: key.label ?? '',
        keyPreview: maskApiKey(key.apiKey ?? ''),
        isDuplicate: !!existing,
        existingId: existing?.id,
      });
    }

    logger.info('[API Keys v1] Import preview completed', {
      userId: user.id,
      keyCount: previewKeys.length,
      duplicateCount,
      signatureValid,
    });

    return successResponse({
      valid: true,
      signatureValid,
      keyCount: previewKeys.length,
      keys: previewKeys,
      duplicateCount,
    });
  } catch (error) {
    logger.error('[API Keys v1] Error previewing import file', {}, error instanceof Error ? error : undefined);
    return NextResponse.json({ valid: false, error: 'Failed to preview import file' }, { status: 500 });
  }
}

/**
 * POST /api/v1/api-keys - Action dispatch or create
 */
export const POST = createContextHandler(async (req, { user }) =>
  dispatchAction(
    req,
    {
      'auto-associate': () => handleAutoAssociate(req, user),
      export: () => handleExport(req, user),
      import: () => handleImport(req, user),
      'import-preview': () => handleImportPreview(req, user),
    },
    () => handleCreate(req, user)
  )
);
