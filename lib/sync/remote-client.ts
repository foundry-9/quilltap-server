/**
 * Sync Remote Client
 *
 * HTTP client for making authenticated requests to remote Quilltap instances
 * during sync operations.
 */

import { logger } from '@/lib/logger';
import { decryptApiKey } from '@/lib/encryption';
import {
  SyncInstance,
  SyncHandshakeRequest,
  SyncHandshakeResponse,
  SyncDeltaRequest,
  SyncDeltaResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncEntityDelta,
  SyncMapping,
} from './types';
import { getLocalVersionInfo } from './version-checker';

/**
 * Default timeout for remote requests (30 seconds)
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Extended timeout for sync operations (2 minutes)
 */
const SYNC_TIMEOUT = 120000;

/**
 * Error thrown when remote request fails
 */
export class RemoteSyncError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public remoteError?: string
  ) {
    super(message);
    this.name = 'RemoteSyncError';
  }
}

/**
 * Decrypt the API key from a sync instance
 */
function getDecryptedApiKey(instance: SyncInstance): string {
  try {
    const decrypted = decryptApiKey(
      instance.apiKey.ciphertext,
      instance.apiKey.iv,
      instance.apiKey.authTag,
      instance.userId
    );
    return decrypted;
  } catch (error) {
    logger.error('Failed to decrypt API key for sync instance', {
      context: 'sync:remote-client',
      instanceId: instance.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new RemoteSyncError('Failed to decrypt API key');
  }
}

/**
 * Make an authenticated request to a remote Quilltap instance
 */
async function makeRemoteRequest<T>(
  instance: SyncInstance,
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  timeout: number = DEFAULT_TIMEOUT
): Promise<T> {
  const url = new URL(endpoint, instance.url);
  const apiKey = await getDecryptedApiKey(instance);

  logger.debug('Making remote sync request', {
    context: 'sync:remote-client',
    instanceId: instance.id,
    url: url.toString(),
    method,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Sync-Instance-Id': instance.id,
    };

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `Remote request failed with status ${response.status}`;
      try {
        const errorBody = await response.json();
        errorMessage = errorBody.error || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }

      logger.warn('Remote sync request failed', {
        context: 'sync:remote-client',
        instanceId: instance.id,
        url: url.toString(),
        status: response.status,
        error: errorMessage,
      });

      throw new RemoteSyncError(errorMessage, response.status);
    }

    const data = await response.json();

    logger.debug('Remote sync request successful', {
      context: 'sync:remote-client',
      instanceId: instance.id,
      url: url.toString(),
    });

    return data as T;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof RemoteSyncError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('Remote sync request timed out', {
        context: 'sync:remote-client',
        instanceId: instance.id,
        url: url.toString(),
        timeout,
      });
      throw new RemoteSyncError('Request timed out', 408);
    }

    logger.error('Remote sync request error', {
      context: 'sync:remote-client',
      instanceId: instance.id,
      url: url.toString(),
      error: error instanceof Error ? error.message : String(error),
    });

    throw new RemoteSyncError(
      error instanceof Error ? error.message : 'Unknown error',
      undefined,
      String(error)
    );
  }
}

/**
 * Perform handshake with remote instance
 */
export async function remoteHandshake(
  instance: SyncInstance
): Promise<SyncHandshakeResponse> {
  logger.info('Performing remote handshake', {
    context: 'sync:remote-client',
    instanceId: instance.id,
    instanceUrl: instance.url,
  });

  const request: SyncHandshakeRequest = {
    versionInfo: getLocalVersionInfo(),
  };

  const response = await makeRemoteRequest<SyncHandshakeResponse>(
    instance,
    '/api/sync/handshake',
    'POST',
    request
  );

  logger.info('Remote handshake complete', {
    context: 'sync:remote-client',
    instanceId: instance.id,
    compatible: response.compatible,
    remoteUserId: response.remoteUserId,
  });

  return response;
}

/**
 * Fetch deltas from remote instance
 */
export async function fetchRemoteDeltas(
  instance: SyncInstance,
  sinceTimestamp: string | null,
  limit: number = 100
): Promise<SyncDeltaResponse> {
  logger.info('Fetching remote deltas', {
    context: 'sync:remote-client',
    instanceId: instance.id,
    sinceTimestamp,
    limit,
  });

  const request: SyncDeltaRequest = {
    sinceTimestamp,
    limit,
  };

  const response = await makeRemoteRequest<SyncDeltaResponse>(
    instance,
    '/api/sync/delta',
    'POST',
    request,
    SYNC_TIMEOUT
  );

  logger.info('Fetched remote deltas', {
    context: 'sync:remote-client',
    instanceId: instance.id,
    deltaCount: response.deltas.length,
    hasMore: response.hasMore,
  });

  return response;
}

/**
 * Push local deltas to remote instance
 */
export async function pushToRemote(
  instance: SyncInstance,
  deltas: SyncEntityDelta[],
  mappings: Array<{ localId: string; remoteId?: string; entityType: string }>
): Promise<SyncPushResponse> {
  logger.info('Pushing deltas to remote', {
    context: 'sync:remote-client',
    instanceId: instance.id,
    deltaCount: deltas.length,
    mappingCount: mappings.length,
  });

  const request: SyncPushRequest = {
    deltas,
    mappings: mappings as SyncPushRequest['mappings'],
  };

  const response = await makeRemoteRequest<SyncPushResponse>(
    instance,
    '/api/sync/push',
    'POST',
    request,
    SYNC_TIMEOUT
  );

  logger.info('Pushed deltas to remote', {
    context: 'sync:remote-client',
    instanceId: instance.id,
    success: response.success,
    mappingUpdates: response.mappingUpdates.length,
    conflicts: response.conflicts.length,
    errors: response.errors.length,
  });

  return response;
}

/**
 * Fetch mappings from remote instance
 */
export async function fetchRemoteMappings(
  instance: SyncInstance
): Promise<{ mappings: SyncMapping[] }> {
  logger.info('Fetching remote mappings', {
    context: 'sync:remote-client',
    instanceId: instance.id,
  });

  const response = await makeRemoteRequest<{ mappings: SyncMapping[] }>(
    instance,
    `/api/sync/mappings?instanceId=${instance.id}`,
    'GET'
  );

  logger.info('Fetched remote mappings', {
    context: 'sync:remote-client',
    instanceId: instance.id,
    mappingCount: response.mappings.length,
  });

  return response;
}

/**
 * Fetch file content from remote instance.
 * Used for large files that couldn't be included inline in deltas.
 */
export async function fetchRemoteFileContent(
  instance: SyncInstance,
  remoteFileId: string
): Promise<{ content: Buffer; sha256?: string; mimeType?: string }> {
  const url = new URL(`/api/sync/files/${remoteFileId}/content`, instance.url);
  const apiKey = await getDecryptedApiKey(instance);

  logger.info('Fetching remote file content', {
    context: 'sync:remote-client',
    instanceId: instance.id,
    remoteFileId,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Sync-Instance-Id': instance.id,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `Remote file request failed with status ${response.status}`;
      try {
        const errorBody = await response.json();
        errorMessage = errorBody.error || errorMessage;
      } catch {
        // Might not be JSON
      }

      logger.warn('Remote file content request failed', {
        context: 'sync:remote-client',
        instanceId: instance.id,
        remoteFileId,
        status: response.status,
        error: errorMessage,
      });

      throw new RemoteSyncError(errorMessage, response.status);
    }

    // Get file content as buffer
    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);

    // Extract metadata from headers
    const sha256 = response.headers.get('X-File-SHA256') || undefined;
    const mimeType = response.headers.get('Content-Type') || undefined;

    logger.info('Fetched remote file content', {
      context: 'sync:remote-client',
      instanceId: instance.id,
      remoteFileId,
      size: content.length,
      sha256: sha256?.substring(0, 16),
      mimeType,
    });

    return { content, sha256, mimeType };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof RemoteSyncError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('Remote file content request timed out', {
        context: 'sync:remote-client',
        instanceId: instance.id,
        remoteFileId,
      });
      throw new RemoteSyncError('Request timed out', 408);
    }

    logger.error('Remote file content request error', {
      context: 'sync:remote-client',
      instanceId: instance.id,
      remoteFileId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new RemoteSyncError(
      error instanceof Error ? error.message : 'Unknown error',
      undefined,
      String(error)
    );
  }
}

/**
 * Test connection to a remote instance (without full sync)
 */
export async function testRemoteConnection(
  url: string,
  apiKey: string
): Promise<{ success: boolean; error?: string; versionInfo?: SyncHandshakeResponse }> {
  logger.info('Testing remote connection', {
    context: 'sync:remote-client',
    url,
  });

  // Create a temporary instance object for the request
  const tempInstance: SyncInstance = {
    id: 'temp-test',
    userId: 'temp-test',
    name: 'Connection Test',
    url,
    apiKey: { ciphertext: apiKey, iv: '', authTag: '' }, // Will be handled specially
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const fullUrl = new URL('/api/sync/handshake', url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    const response = await fetch(fullUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        versionInfo: getLocalVersionInfo(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `Connection failed with status ${response.status}`;
      try {
        const errorBody = await response.json();
        errorMessage = errorBody.error || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }

      logger.warn('Remote connection test failed', {
        context: 'sync:remote-client',
        url,
        status: response.status,
        error: errorMessage,
      });

      return { success: false, error: errorMessage };
    }

    const data = (await response.json()) as SyncHandshakeResponse;

    logger.info('Remote connection test successful', {
      context: 'sync:remote-client',
      url,
      compatible: data.compatible,
    });

    return {
      success: true,
      versionInfo: data,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Remote connection test error', {
      context: 'sync:remote-client',
      url,
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}
