/**
 * Group Scenarios — collection endpoint.
 *
 * GET  /api/v1/groups/[id]/scenarios          — list every scenario in the
 *                                                group's `Scenarios/` folder,
 *                                                with frontmatter parsed and
 *                                                default-conflict resolution
 *                                                applied. `?includeArchived=true`
 *                                                also returns archived scenarios.
 * POST /api/v1/groups/[id]/scenarios          — create a new scenario file.
 *                                                Body: { filename, name?,
 *                                                description?, isDefault?,
 *                                                body }.
 *
 * Both provision the group's official store and its `Scenarios/` folder
 * through the scenario location (`ensure: true`), plus the group's
 * `Knowledge/` folder, so they're usable before the next startup heal. The
 * bodies live in `lib/mount-index/scenario-item-route-factory.ts`.
 */

import { createContextParamsHandler } from '@/lib/api/middleware';
import { createScenarioCollectionBodies } from '@/lib/mount-index/scenario-item-route-factory';
import { ensureGroupKnowledgeFolder } from '@/lib/mount-index/group-knowledge';

const { list, create } = createScenarioCollectionBodies<{ id: string }>({
  scope: 'group',
  ownerLabel: 'Group',
  logTag: '[Groups v1]',
  logIdKey: 'groupId',
  afterEnsure: async (mountPointId) => {
    await ensureGroupKnowledgeFolder(mountPointId);
  },
});

export const GET = createContextParamsHandler<{ id: string }>(list);
export const POST = createContextParamsHandler<{ id: string }>(create);
