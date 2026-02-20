/**
 * Projects API v1 - Mount Point Actions
 *
 * GET /api/v1/projects/[id]?action=get-mount-point - Get project mount point config
 * PUT /api/v1/projects/[id]?action=set-mount-point - Set project mount point
 * DELETE /api/v1/projects/[id]?action=clear-mount-point - Clear project mount point
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOwnership } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { notFound, validationError, serverError, successResponse } from '@/lib/api/responses';
import { mountPointsRepository } from '@/lib/database/repositories/mount-points.repository';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { setMountPointSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * Get project mount point configuration
 */
export async function handleGetMountPoint(
  projectId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    // Get current mount point if set
    let currentMountPoint = null;
    if (project.mountPointId) {
      const mp = await mountPointsRepository.findById(project.mountPointId);
      if (mp) {
        currentMountPoint = {
          id: mp.id,
          name: mp.name,
          backendType: mp.backendType,
          healthStatus: mp.healthStatus,
        };
      }
    }

    // Get system default mount point
    let defaultMountPoint = null;
    const defaultMp = await mountPointsRepository.findDefault();
    if (defaultMp) {
      defaultMountPoint = {
        id: defaultMp.id,
        name: defaultMp.name,
        backendType: defaultMp.backendType,
        healthStatus: defaultMp.healthStatus,
      };
    }

    // Effective mount point is current if set, otherwise default
    const effectiveMountPoint = currentMountPoint || defaultMountPoint;

    // Count files in this project
    const allFiles = await repos.files.findAll();
    const fileCount = allFiles.filter(f => f.projectId === projectId).length;

    return successResponse({
      projectId,
      mountPointId: project.mountPointId || null,
      currentMountPoint,
      defaultMountPoint,
      effectiveMountPoint,
      fileCount,
    });
  } catch (error) {
    logger.error('[Projects v1] Error getting project mount point', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to get mount point');
  }
}

/**
 * Set project mount point (with optional file migration)
 */
export async function handleSetMountPoint(
  req: NextRequest,
  projectId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    const body = await req.json();
    const { mountPointId, migrateFiles } = setMountPointSchema.parse(body);

    // Verify mount point exists
    const mountPoint = await mountPointsRepository.findById(mountPointId);
    if (!mountPoint) {
      return notFound('Mount point');
    }

    // If migrateFiles is requested, migrate all project files to the new mount point
    let migrationResult = { migrated: 0, failed: 0, errors: [] as Array<{ fileId: string; error: string }> };

    if (migrateFiles) {
      const allFiles = await repos.files.findAll();
      const projectFiles = allFiles.filter(f => f.projectId === projectId);

      for (const file of projectFiles) {
        try {
          // Skip if file is already on the target mount point
          if (file.mountPointId === mountPointId) {
            continue;
          }

          // Download file from current location
          const buffer = await fileStorageManager.downloadFile(file);

          // Upload to new mount point
          const uploadResult = await fileStorageManager.uploadFile({
            userId: user.id,
            fileId: file.id,
            filename: file.originalFilename,
            content: buffer,
            contentType: file.mimeType,
            projectId,
            mountPointId,
          });

          // Update file record with new storage info
          await repos.files.update(file.id, {
            mountPointId: uploadResult.mountPointId,
            storageKey: uploadResult.storageKey,
          });

          // Delete from old mount point
          await fileStorageManager.deleteFile(file);

          migrationResult.migrated++;
        } catch (error) {
          migrationResult.failed++;
          migrationResult.errors.push({
            fileId: file.id,
            error: error instanceof Error ? error.message : String(error),
          });
          logger.error('[Projects v1] Failed to migrate file', {
            fileId: file.id,
            projectId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('[Projects v1] File migration completed', {
        projectId,
        mountPointId,
        migrated: migrationResult.migrated,
        failed: migrationResult.failed,
      });
    }

    // Update project with new mount point
    await repos.projects.setMountPoint(projectId, mountPointId);

    logger.info('[Projects v1] Mount point set for project', { projectId, mountPointId });

    return successResponse({
      success: true,
      mountPointId,
      migration: migrateFiles ? migrationResult : undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    logger.error('[Projects v1] Error setting mount point', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to set mount point');
  }
}

/**
 * Clear project mount point (revert to system default)
 */
export async function handleClearMountPoint(
  projectId: string,
  { user, repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const project = await repos.projects.findById(projectId);
    if (!checkOwnership(project, user.id)) {
      return notFound('Project');
    }

    // Clear mount point (will use system default)
    await repos.projects.setMountPoint(projectId, null);

    logger.info('[Projects v1] Mount point cleared for project', { projectId });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Projects v1] Error clearing mount point', { projectId }, error instanceof Error ? error : undefined);
    return serverError('Failed to clear mount point');
  }
}
