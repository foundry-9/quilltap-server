/**
 * Chats API v1 - Group Stores Action
 *
 * GET /api/v1/chats/[id]?action=group-stores
 *
 * Returns the document stores belonging to the groups that the current
 * chat's user-persona character(s) are members of. Used by the
 * LibraryFilePickerModal to show a "Group Files" section above the
 * Projects section.
 */
import { NextResponse } from 'next/server';
import { notFound, successResponse } from '@/lib/api/responses';
import { castGroupMounts } from '@/lib/mount-index/reach';
import { logger } from '@/lib/logger';
import type { RequestContext } from '@/lib/api/middleware';

export async function handleGetGroupStores(
  chatId: string,
  { repos }: RequestContext
): Promise<NextResponse> {
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    return notFound('Chat');
  }

  // The group tier of the cast this picker serves: the user-controlled
  // character participants (the persona's groups), through the shared walk.
  const personaIds = chat.participants
    .filter(
      (p) => p.type === 'CHARACTER' && !!p.characterId && p.controlledBy === 'user' && p.status !== 'removed',
    )
    .map((p) => p.characterId as string);
  const mountIds = await castGroupMounts(personaIds);
  logger.debug('[Chats v1] Resolved persona group stores', { chatId, personaCount: personaIds.length, mountCount: mountIds.length });

  const stores: Array<{
    id: string;
    name: string;
    mountType: string;
    storeType: string;
    enabled: boolean;
  }> = [];

  for (const id of mountIds) {
    const mp = await repos.docMountPoints.findById(id);
    if (!mp) continue;
    if (!mp.enabled) continue;
    if (mp.mountType !== 'database') continue;
    if (mp.storeType === 'character') continue;

    stores.push({
      id: mp.id,
      name: mp.name,
      mountType: mp.mountType,
      storeType: mp.storeType ?? 'documents',
      enabled: mp.enabled,
    });
  }

  return successResponse({ stores });
}
