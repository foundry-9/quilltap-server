/**
 * Project Mount Point Management
 *
 * GET    /api/projects/[id]/mount-point - Get project's mount point info
 * PUT    /api/projects/[id]/mount-point - Set project's mount point (with optional migration)
 * DELETE /api/projects/[id]/mount-point - Clear project's mount point
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { fileStorageManager } from '@/lib/file-storage/manager';
import {
  migrateProjectFiles,
  getFileMigrationCount,
} from '@/lib/file-storage/project-file-migration';

/**
 * GET /api/projects/[id]/mount-point
 * Get the project's current mount point and file migration info
 */
export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Getting project mount point', { projectId: id, userId: user.id });

      const project = await repos.projects.findById(id);
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      // Get current mount point info
      let currentMountPoint = null;
      if (project.mountPointId) {
        const mp = fileStorageManager.getMountPoint(project.mountPointId);
        if (mp) {
          currentMountPoint = {
            id: mp.id,
            name: mp.name,
            backendType: mp.backendType,
            healthStatus: mp.healthStatus,
          };
        }
      }

      // Get default mount point info
      const defaultMountPointId = fileStorageManager.getDefaultMountPointId();
      let defaultMountPoint = null;
      if (defaultMountPointId) {
        const mp = fileStorageManager.getMountPoint(defaultMountPointId);
        if (mp) {
          defaultMountPoint = {
            id: mp.id,
            name: mp.name,
            backendType: mp.backendType,
            healthStatus: mp.healthStatus,
          };
        }
      }

      // Get file count for the project
      const files = await repos.files.findByProjectId(project.userId, id);
      const fileCount = files.length;

      return NextResponse.json({
        projectId: id,
        mountPointId: project.mountPointId || null,
        currentMountPoint,
        defaultMountPoint,
        fileCount,
        effectiveMountPoint: currentMountPoint || defaultMountPoint,
      });
    } catch (error) {
      logger.error('Error getting project mount point', {
        endpoint: '/api/projects/[id]/mount-point',
        method: 'GET',
        projectId: id,
      }, error instanceof Error ? error : undefined);
      return NextResponse.json({ error: 'Failed to get project mount point' }, { status: 500 });
    }
  }
);

/**
 * PUT /api/projects/[id]/mount-point
 * Set the project's mount point, optionally migrating existing files
 *
 * Body: {
 *   mountPointId: string,           // The target mount point ID
 *   migrateFiles?: boolean,         // Whether to migrate existing files (default: true)
 * }
 */
export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      const body = await req.json();
      const { mountPointId, migrateFiles = true } = body;

      logger.debug('Setting project mount point', {
        projectId: id,
        mountPointId,
        migrateFiles,
        userId: user.id,
      });

      if (!mountPointId || typeof mountPointId !== 'string') {
        return NextResponse.json(
          { error: 'mountPointId is required and must be a string' },
          { status: 400 }
        );
      }

      // Verify project exists
      const project = await repos.projects.findById(id);
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      // Verify mount point exists and is healthy
      const targetMountPoint = fileStorageManager.getMountPoint(mountPointId);
      if (!targetMountPoint) {
        return NextResponse.json({ error: 'Mount point not found' }, { status: 404 });
      }

      if (targetMountPoint.healthStatus === 'unhealthy') {
        return NextResponse.json(
          { error: 'Cannot use an unhealthy mount point' },
          { status: 400 }
        );
      }

      // If same mount point, nothing to do
      if (project.mountPointId === mountPointId) {
        return NextResponse.json({
          success: true,
          message: 'Project already uses this mount point',
          migration: null,
        });
      }

      // Check file migration count
      const filesToMigrate = await getFileMigrationCount(id, mountPointId);

      // If there are files and migration is requested, migrate them
      let migrationResult = null;
      if (migrateFiles && filesToMigrate > 0) {
        logger.info('Starting file migration for project', {
          projectId: id,
          filesToMigrate,
          fromMountPointId: project.mountPointId,
          toMountPointId: mountPointId,
        });

        migrationResult = await migrateProjectFiles(
          id,
          project.mountPointId || null,
          mountPointId
        );

        if (!migrationResult.success && migrationResult.migrated === 0) {
          // Complete failure - don't update the project
          return NextResponse.json(
            {
              error: 'File migration failed',
              migration: migrationResult,
            },
            { status: 500 }
          );
        }
      }

      // Update the project's mount point
      const updatedProject = await repos.projects.setMountPoint(id, mountPointId);

      if (!updatedProject) {
        return NextResponse.json(
          { error: 'Failed to update project mount point' },
          { status: 500 }
        );
      }

      logger.info('Project mount point updated', {
        projectId: id,
        mountPointId,
        filesMigrated: migrationResult?.migrated || 0,
      });

      return NextResponse.json({
        success: true,
        project: {
          id: updatedProject.id,
          name: updatedProject.name,
          mountPointId: updatedProject.mountPointId,
        },
        mountPoint: {
          id: targetMountPoint.id,
          name: targetMountPoint.name,
          backendType: targetMountPoint.backendType,
          healthStatus: targetMountPoint.healthStatus,
        },
        migration: migrationResult,
      });
    } catch (error) {
      logger.error('Error setting project mount point', {
        endpoint: '/api/projects/[id]/mount-point',
        method: 'PUT',
        projectId: id,
      }, error instanceof Error ? error : undefined);
      return NextResponse.json({ error: 'Failed to set project mount point' }, { status: 500 });
    }
  }
);

/**
 * DELETE /api/projects/[id]/mount-point
 * Clear the project's mount point (will use system default)
 */
export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id }) => {
    try {
      logger.debug('Clearing project mount point', { projectId: id, userId: user.id });

      const project = await repos.projects.findById(id);
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      if (!project.mountPointId) {
        return NextResponse.json({
          success: true,
          message: 'Project already uses system default',
        });
      }

      // Clear the mount point (project will use system default)
      const updatedProject = await repos.projects.setMountPoint(id, null);

      if (!updatedProject) {
        return NextResponse.json(
          { error: 'Failed to clear project mount point' },
          { status: 500 }
        );
      }

      logger.info('Project mount point cleared', { projectId: id });

      return NextResponse.json({
        success: true,
        message: 'Project will now use system default mount point',
        project: {
          id: updatedProject.id,
          name: updatedProject.name,
          mountPointId: updatedProject.mountPointId,
        },
      });
    } catch (error) {
      logger.error('Error clearing project mount point', {
        endpoint: '/api/projects/[id]/mount-point',
        method: 'DELETE',
        projectId: id,
      }, error instanceof Error ? error : undefined);
      return NextResponse.json({ error: 'Failed to clear project mount point' }, { status: 500 });
    }
  }
);
