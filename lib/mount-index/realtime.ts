/**
 * The realtime hint for a document store's contents: what changed is "this
 * store", and an open browser (the Scriptorium, Document Mode's picker)
 * re-reads its listing through the REST API. Published from the parent-side
 * chokepoints — the database-store change events, the file and folder
 * operations, the folder route — and a no-op in the job child, whose
 * buffered writes surface through `job-topics.ts`.
 *
 * Server-only.
 *
 * @module lib/mount-index/realtime
 */

import { publishRealtime } from '@/lib/realtime/bus';

/** Say that a store's files or folders changed. */
export function publishMountChange(mountPointId: string): void {
  publishRealtime('mountPoints', mountPointId);
}
