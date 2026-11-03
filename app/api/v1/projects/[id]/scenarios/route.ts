/**
 * Project Scenarios — collection endpoint.
 *
 * GET  /api/v1/projects/[id]/scenarios          — list every scenario in
 *                                                  the project's `Scenarios/`
 *                                                  folder, with frontmatter
 *                                                  parsed and default-conflict
 *                                                  resolution applied.
 *                                                  `?includeArchived=true` also
 *                                                  returns archived scenarios.
 * POST /api/v1/projects/[id]/scenarios          — create a new scenario file.
 *                                                  Body: { filename, name?,
 *                                                  description?, isDefault?,
 *                                                  body }.
 *
 * The POST provisions the project's official store and its `Scenarios/` folder
 * through the scenario location (`ensure: true`), so users creating one
 * don't have to wait for the next startup-time heal pass; the GET only reads (#136). The bodies
 * live in `lib/mount-index/scenario-item-route-factory.ts`.
 */

import { createContextParamsHandler } from '@/lib/api/middleware';
import { createScenarioCollectionBodies } from '@/lib/mount-index/scenario-item-route-factory';

const { list, create } = createScenarioCollectionBodies<{ id: string }>({
  scope: 'project',
  ownerLabel: 'Project',
  logTag: '[Projects v1]',
  logIdKey: 'projectId',
});

export const GET = createContextParamsHandler<{ id: string }>(list);
export const POST = createContextParamsHandler<{ id: string }>(create);
