/**
 * Groups API v1 - Group CRUD Actions
 *
 * GET /api/v1/groups/[id] - Get group details (default)
 * GET /api/v1/groups/[id]?action=members - Get group members
 * GET /api/v1/groups/[id]?action=stores - Get linked stores
 * PUT /api/v1/groups/[id] - Update group (default)
 * DELETE /api/v1/groups/[id] - Delete group (default)
 * POST /api/v1/groups/[id]?action=addMember - Add member
 * POST /api/v1/groups/[id]?action=linkStore - Link store
 * DELETE /api/v1/groups/[id]?action=removeMember - Remove member
 * DELETE /api/v1/groups/[id]?action=unlinkStore - Unlink store
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { notFound, serverError, successResponse, badRequest } from '@/lib/api/responses';
import { updateGroupSchema, addMemberSchema, removeMemberSchema, linkStoreSchema, unlinkStoreSchema } from '../schemas';
import type { AuthenticatedContext } from '@/lib/api/middleware';

/**
 * Get group details with enriched member count
 */
export async function handleGetDefault(
  groupId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const group = await repos.groups.findById(groupId);

    if (!group) {
      return notFound('Group');
    }

    const members = await repos.groupCharacterMembers.findByGroupId(groupId);

    const enrichedGroup = {
      ...group,
      _count: {
        members: members.length,
      },
    };

    return successResponse({ group: enrichedGroup });
  } catch (error) {
    logger.error('[Groups v1] Error fetching group', { groupId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch group');
  }
}

/**
 * Get member characters in the group
 */
export async function handleGetMembers(
  groupId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const group = await repos.groups.findById(groupId);
    if (!group) {
      return notFound('Group');
    }

    const members = await repos.groupCharacterMembers.findByGroupId(groupId);

    const enrichedMembers = await Promise.all(
      members.map(async (m) => {
        const character = await repos.characters.findById(m.characterId);
        if (!character) return null;
        return {
          id: character.id,
          name: character.name,
        };
      })
    );

    return successResponse({ members: enrichedMembers.filter(Boolean) });
  } catch (error) {
    logger.error('[Groups v1] Error fetching group members', { groupId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch group members');
  }
}

/**
 * Get linked document stores for the group
 */
export async function handleGetStores(
  groupId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const group = await repos.groups.findById(groupId);
    if (!group) {
      return notFound('Group');
    }

    const links = await repos.groupDocMountLinks.findByGroupId(groupId);

    const mountPoints = await Promise.all(
      links.map(async (link) => {
        const mountPoint = await repos.docMountPoints.findById(link.mountPointId);
        return mountPoint;
      })
    );

    const validMountPoints = mountPoints.filter((mp: any) => mp !== null);

    return successResponse({ mountPoints: validMountPoints });
  } catch (error) {
    logger.error('[Groups v1] Error fetching group stores', { groupId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch group stores');
  }
}

/**
 * Update group
 */
export async function handlePutDefault(
  req: NextRequest,
  groupId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const existingGroup = await repos.groups.findById(groupId);

    if (!existingGroup) {
      return notFound('Group');
    }

    const body = await req.json();
    const validatedData = updateGroupSchema.parse(body);

    const group = await repos.groups.update(groupId, validatedData);

    logger.info('[Groups v1] Group updated', { groupId });

    return successResponse({ group });
  } catch (error) {
    logger.error('[Groups v1] Error updating group', { groupId }, error instanceof Error ? error : undefined);
    return serverError('Failed to update group');
  }
}

/**
 * Delete group and clean up references
 */
export async function handleDeleteGroup(
  groupId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const existingGroup = await repos.groups.findById(groupId);

    if (!existingGroup) {
      return notFound('Group');
    }

    // Drop all memberships
    await repos.groupCharacterMembers.deleteByGroupId(groupId);

    // Unlink additional stores (do NOT delete them, just drop the links)
    await repos.groupDocMountLinks.deleteByGroupId(groupId);

    // Delete the group itself (orphaning the official store)
    await repos.groups.delete(groupId);

    logger.info('[Groups v1] Group deleted', { groupId });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Groups v1] Error deleting group', { groupId }, error instanceof Error ? error : undefined);
    return serverError('Failed to delete group');
  }
}

/**
 * Add a character member to the group
 */
export async function handleAddMember(
  req: NextRequest,
  groupId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const group = await repos.groups.findById(groupId);
    if (!group) {
      return notFound('Group');
    }

    const body = await req.json();
    const validatedData = addMemberSchema.parse(body);

    const character = await repos.characters.findById(validatedData.characterId);
    if (!character) {
      return badRequest('Character not found');
    }

    await repos.groupCharacterMembers.addMember(groupId, validatedData.characterId);

    logger.info('[Groups v1] Character added to group', {
      groupId,
      characterId: validatedData.characterId,
    });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Groups v1] Error adding member to group', { groupId }, error instanceof Error ? error : undefined);
    return serverError('Failed to add member to group');
  }
}

/**
 * Remove a character member from the group
 */
export async function handleRemoveMember(
  req: NextRequest,
  groupId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const group = await repos.groups.findById(groupId);
    if (!group) {
      return notFound('Group');
    }

    const body = await req.json();
    const validatedData = removeMemberSchema.parse(body);

    await repos.groupCharacterMembers.removeMember(groupId, validatedData.characterId);

    logger.info('[Groups v1] Character removed from group', {
      groupId,
      characterId: validatedData.characterId,
    });

    return successResponse({ success: true });
  } catch (error) {
    logger.error('[Groups v1] Error removing member from group', { groupId }, error instanceof Error ? error : undefined);
    return serverError('Failed to remove member from group');
  }
}

/**
 * Link a document store to the group
 */
export async function handleLinkStore(
  req: NextRequest,
  groupId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const group = await repos.groups.findById(groupId);
    if (!group) {
      return notFound('Group');
    }

    const body = await req.json();
    const validatedData = linkStoreSchema.parse(body);

    const mountPoint = await repos.docMountPoints.findById(validatedData.mountPointId);
    if (!mountPoint) {
      return badRequest('Mount point not found');
    }

    const link = await repos.groupDocMountLinks.link(groupId, validatedData.mountPointId);

    logger.info('[Groups v1] Mount point linked to group', {
      groupId,
      mountPointId: validatedData.mountPointId,
    });

    return successResponse({ link, mountPoint });
  } catch (error) {
    logger.error('[Groups v1] Error linking store to group', { groupId }, error instanceof Error ? error : undefined);
    return serverError('Failed to link store to group');
  }
}

/**
 * Unlink a document store from the group
 */
export async function handleUnlinkStore(
  req: NextRequest,
  groupId: string,
  { repos }: AuthenticatedContext
): Promise<NextResponse> {
  try {
    const group = await repos.groups.findById(groupId);
    if (!group) {
      return notFound('Group');
    }

    const body = await req.json();
    const validatedData = unlinkStoreSchema.parse(body);

    const unlinked = await repos.groupDocMountLinks.unlink(groupId, validatedData.mountPointId);

    if (!unlinked) {
      return badRequest('No link exists between this group and mount point');
    }

    logger.info('[Groups v1] Mount point unlinked from group', {
      groupId,
      mountPointId: validatedData.mountPointId,
    });

    return successResponse({ message: 'Mount point unlinked from group' });
  } catch (error) {
    logger.error('[Groups v1] Error unlinking store from group', { groupId }, error instanceof Error ? error : undefined);
    return serverError('Failed to unlink store from group');
  }
}
