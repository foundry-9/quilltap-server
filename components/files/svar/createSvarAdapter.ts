/**
 * SVAR runtime adapter — the testable wiring core.
 *
 * Takes a LIVE SVAR `IApi` and an injectable `fetch`, and wires `on(action)`
 * handlers that drive the pure route-map (Phase 2) to the v1 mount-point routes.
 * Mirrors SVAR's own data-provider choreography: SVAR optimistically updates its
 * tree, the `on` handler then persists to the server (serialized so a burst of
 * drags can't race), translates failures to a steampunk verdict, fires the
 * post-copy reindex, and asks the host to reload server truth — which reconciles
 * temp ids on success and reverts on error (the plan's "re-read the listing
 * after any mutating op" rule).
 *
 * Deliberately NO React / SVAR-component import: this file is unit-testable with
 * a fake `api` + a mock `fetch`. The React wrapper (`SvarFileManager.tsx`) owns
 * the actual data load + reload and calls `wireSvarAdapter` from the
 * component's `init`.
 *
 * @module components/files/svar/createSvarAdapter
 */

import type { MountCapabilities } from '@/lib/mount-index/capabilities'
import type { IApi, IEntity } from './svar-types'
import { mapSvarEvent } from './event-route-map'
import type { NodeResolver, RouteCall } from './event-route-map'
import { listingToTree } from './listing-to-tree'
import type { MountListing } from './listing-to-tree'
import { nodeIdToRelPath } from './node-id'
import { reindexAfterCopy } from './reindex-after-copy'
import { translateMountOpError } from './error-translation'

export interface AdapterCallbacks {
  /** Surface a user-facing failure (steampunk voice already applied). */
  onError?: (message: string, info: { suggestCopy: boolean; conflict: boolean }) => void
  /** A cross-storage copy is being re-indexed in the background. */
  onIndexing?: (target: { mountId: string; path: string }) => void
  /** Re-read the listing and refresh SVAR's tree (reconcile / revert). */
  onReloadNeeded?: () => void
  /** Debug logging hook (wired to the app logger by the host). */
  log?: (message: string, data?: Record<string, unknown>) => void
}

export interface AdapterConfig {
  mountId: string
  capabilities: MountCapabilities
}

const MUTATING_ACTIONS = ['rename-file', 'create-file', 'delete-files', 'move-files', 'copy-files'] as const

/** HTTP failure carrying the body `code` for error translation. */
export class HttpError extends Error {
  constructor(public status: number, public code?: string) {
    super(code ?? `HTTP ${status}`)
    this.name = 'HttpError'
  }
}

/**
 * Wire the adapter onto a live SVAR api. Returns nothing; the handlers live on
 * the api until it is torn down with the component.
 */
export function wireSvarAdapter(
  api: IApi,
  config: AdapterConfig,
  cb: AdapterCallbacks = {},
  fetchImpl: typeof fetch = fetch
): void {
  // Node ids are mount-relative paths; the mount id comes from config (the
  // costume owns it) and the live tree supplies only file-vs-folder.
  const resolve: NodeResolver = (id) => {
    const relativePath = nodeIdToRelPath(id)
    const node = api.getFile(id)
    const type: 'file' | 'folder' = node?.type === 'folder' || relativePath === '' ? 'folder' : 'file'
    return { mountId: config.mountId, relativePath, type }
  }

  // Serialize mutations so a flurry of drags/renames can't interleave.
  let chain: Promise<void> = Promise.resolve()
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    chain = chain.then(task, task)
    return chain
  }

  for (const action of MUTATING_ACTIONS) {
    api.on(action, (payload: unknown) => {
      if (!allowed(action, config.capabilities)) {
        cb.onError?.('This repository won’t accept changes just now.', { suggestCopy: false, conflict: false })
        cb.onReloadNeeded?.() // revert SVAR's optimistic change
        return
      }
      void enqueue(() => runMutation(action, payload, config, cb, fetchImpl, resolve))
    })
  }
}

function allowed(action: string, c: MountCapabilities): boolean {
  switch (action) {
    case 'rename-file':
      return c.canWrite
    case 'create-file':
      return c.canWrite || c.canCreateFolder
    case 'delete-files':
      return c.canDelete
    case 'move-files':
    case 'copy-files':
      return c.canMoveOut
    default:
      return true
  }
}

async function runMutation(
  action: string,
  payload: unknown,
  config: AdapterConfig,
  cb: AdapterCallbacks,
  fetchImpl: typeof fetch,
  resolve: NodeResolver
): Promise<void> {
  const calls = mapSvarEvent(action, payload, { resolve, mountId: config.mountId })
  if (calls.length === 0) return

  for (const call of calls) {
    if (call.unsupported) {
      cb.onError?.(call.unsupported, { suggestCopy: false, conflict: false })
      continue
    }
    try {
      const result = await sendCall(fetchImpl, call, payload)
      cb.log?.('[SVAR adapter] op ok', { op: call.op, url: call.url })
      if ((call.op === 'copy-file' || call.op === 'move-file') && isFileOpResult(result)) {
        const target = reindexAfterCopy(result)
        if (target) {
          cb.onIndexing?.(target)
          void fireReindex(fetchImpl, target, cb)
        }
      }
    } catch (err) {
      const verdict = translateMountOpError(toErrorInput(err))
      cb.onError?.(verdict.message, { suggestCopy: verdict.suggestCopy, conflict: verdict.conflict })
      cb.log?.('[SVAR adapter] op failed', { op: call.op, url: call.url, error: String(err) })
    }
  }

  // Re-read server truth: reconciles new ids on success, reverts on failure.
  cb.onReloadNeeded?.()
}

/** Execute one RouteCall; throws HttpError on a non-2xx, returns parsed JSON (if any). */
async function sendCall(fetchImpl: typeof fetch, call: RouteCall, payload: unknown): Promise<unknown> {
  const init: RequestInit = { method: call.method }

  if (call.multipart) {
    const form = new FormData()
    const file = (payload as { file?: { file?: File } })?.file?.file
    if (file) form.append('file', file)
    form.append('path', String((call.body as { path: string }).path))
    init.body = form
  } else if (call.body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(call.body)
  }

  const res = await fetchImpl(call.url, init)
  if (!res.ok) {
    let code: string | undefined
    try {
      code = ((await res.json()) as { code?: string })?.code
    } catch {
      /* non-JSON error body */
    }
    throw new HttpError(res.status, code)
  }

  const contentType = res.headers?.get?.('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      return await res.json()
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Fire-and-forget scoped reindex + embed; a failure must NOT undo the copy. */
async function fireReindex(
  fetchImpl: typeof fetch,
  target: { mountId: string; path: string },
  cb: AdapterCallbacks
): Promise<void> {
  const base = `/api/v1/mount-points/${target.mountId}`
  const body = JSON.stringify({ path: target.path })
  const headers = { 'content-type': 'application/json' }
  try {
    await fetchImpl(`${base}?action=reindex`, { method: 'POST', headers, body })
    await fetchImpl(`${base}?action=embed`, { method: 'POST', headers, body })
    cb.log?.('[SVAR adapter] reindex+embed enqueued', target)
  } catch (err) {
    cb.log?.('[SVAR adapter] reindex enqueue failed (non-fatal)', { error: String(err) })
  }
}

export interface PickerSelection {
  relativePath: string
  type: 'file' | 'folder'
}

/**
 * Wire a readonly picker's selection reporting onto a live SVAR api (testable,
 * no React/SVAR-component import). Reports on both single-click highlight
 * (`select-file`) and double-click choose (`open-file`); `select` filters which
 * node kind counts as a valid pick. The host's Select button reads the latest.
 */
export function wirePickerSelection(
  api: IApi,
  opts: { select?: 'file' | 'folder' | 'any'; onPick: (item: PickerSelection | null) => void }
): void {
  const select = opts.select ?? 'any'
  const report = (id: string | undefined) => {
    if (!id) return opts.onPick(null)
    const node = api.getFile(id)
    const type: 'file' | 'folder' = node?.type === 'folder' ? 'folder' : 'file'
    if (select !== 'any' && type !== select) return opts.onPick(null)
    opts.onPick({ relativePath: nodeIdToRelPath(id), type })
  }
  api.on('select-file', (ev: { id?: string }) => report(ev?.id))
  api.on('open-file', (ev: { id?: string }) => report(ev?.id))
}

/** Load a mount's listing and map it to SVAR tree nodes. */
export async function loadMountTree(mountId: string, fetchImpl: typeof fetch = fetch): Promise<IEntity[]> {
  const res = await fetchImpl(`/api/v1/mount-points/${mountId}/files`)
  if (!res.ok) throw new HttpError(res.status)
  const listing = (await res.json()) as MountListing
  return listingToTree(listing)
}

function isFileOpResult(x: unknown): x is { strategy: string; destMountPointId: string; destPath: string } {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { strategy?: unknown }).strategy === 'string' &&
    typeof (x as { destPath?: unknown }).destPath === 'string' &&
    typeof (x as { destMountPointId?: unknown }).destMountPointId === 'string'
  )
}

function toErrorInput(err: unknown): { status?: number; code?: string } {
  if (err instanceof HttpError) return { status: err.status, code: err.code }
  return {}
}
