/**
 * Sync Instance Test Connection API
 *
 * POST /api/sync/instances/[id]/test
 *
 * Test the connection to a remote sync instance.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { remoteHandshake, RemoteSyncError } from '@/lib/sync/remote-client';

/**
 * POST /api/sync/instances/[id]/test
 *
 * Test connection to the remote instance and verify compatibility.
 */
export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    const startTime = Date.now();

    try {
      logger.info('Testing sync instance connection', {
        context: 'api:sync:instances:[id]:test',
        userId: user.id,
        instanceId: id,
      });

      const instance = await repos.syncInstances.findById(id);

      if (!instance) {
        logger.warn('Sync instance not found for test', {
          context: 'api:sync:instances:[id]:test',
          userId: user.id,
          instanceId: id,
        });
        return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
      }

      // Verify ownership
      if (instance.userId !== user.id) {
        logger.warn('Sync instance test denied - not owner', {
          context: 'api:sync:instances:[id]:test',
          userId: user.id,
          instanceId: id,
          ownerId: instance.userId,
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // Perform handshake to test connection
      try {
        const handshakeResult = await remoteHandshake(instance);

        // Update instance with remote version info
        if (handshakeResult.versionInfo) {
          await repos.syncInstances.update(id, {
            schemaVersion: handshakeResult.versionInfo.schemaVersion,
            appVersion: handshakeResult.versionInfo.appVersion,
            remoteUserId: handshakeResult.remoteUserId,
          });
        }

        const duration = Date.now() - startTime;

        logger.info('Sync instance test complete', {
          context: 'api:sync:instances:[id]:test',
          userId: user.id,
          instanceId: id,
          compatible: handshakeResult.compatible,
          durationMs: duration,
        });

        return NextResponse.json(
          {
            success: true,
            compatible: handshakeResult.compatible,
            reason: handshakeResult.reason,
            remoteVersion: handshakeResult.versionInfo,
          },
          { status: 200 }
        );
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof RemoteSyncError) {
          logger.warn('Sync instance test failed', {
            context: 'api:sync:instances:[id]:test',
            userId: user.id,
            instanceId: id,
            error: error.message,
            statusCode: error.statusCode,
            durationMs: duration,
          });

          return NextResponse.json(
            {
              success: false,
              error: error.message,
              statusCode: error.statusCode,
            },
            { status: 200 } // Return 200 with success:false for expected failures
          );
        }

        throw error;
      }
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Error testing sync instance connection', {
        context: 'api:sync:instances:[id]:test',
        instanceId: id,
        error: error instanceof Error ? error.message : String(error),
        durationMs: duration,
      });

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }
);
