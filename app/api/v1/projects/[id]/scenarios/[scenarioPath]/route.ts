/**
 * Project Scenarios — single-scenario endpoint.
 *
 * Routes:
 *   GET    /api/v1/projects/[id]/scenarios/[scenarioPath]  — read one
 *   PUT    /api/v1/projects/[id]/scenarios/[scenarioPath]  — update content + frontmatter
 *   POST   /api/v1/projects/[id]/scenarios/[scenarioPath]?action=rename
 *                                                         — rename the file
 *   DELETE /api/v1/projects/[id]/scenarios/[scenarioPath]  — delete the file
 *
 * `[scenarioPath]` is the URL-encoded filename relative to `Scenarios/`.
 * The route accepts the bare filename (with or without `.md`) and prefixes
 * `Scenarios/` server-side; `..` segments are rejected. 
 *
 * PUT, POST and DELETE all honour `?includeArchived=true` on the freshly-listed
 * scenarios they return, so a manager with "Show archived" ticked gets back a
 * list that still contains the row it just changed.
 *
 * The handler bodies live in the shared factory
 * (`lib/mount-index/scenario-item-route-factory.ts`), which reads and writes
 * through the project's scenario location; this file only supplies the labels.
 */

import { createScenarioItemHandlers } from '@/lib/mount-index/scenario-item-route-factory';

export const { GET, PUT, POST, DELETE } = createScenarioItemHandlers<{ id: string; scenarioPath: string }>({
  scope: 'project',
  ownerLabel: 'Project',
  logTag: '[Projects v1]',
  logIdKey: 'projectId',
});
