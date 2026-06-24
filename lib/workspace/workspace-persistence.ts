/**
 * Tabbed workspace — localStorage persistence.
 *
 * Serializes {@link WorkspaceState} to a per-instance localStorage key and
 * hydrates it back, validating the shape (Zod) and pruning tabs that reference
 * entities which no longer exist (e.g. a persisted `chatId` whose chat was
 * deleted, or a terminal/document child tab whose parent Salon tab is gone).
 * No DB, no migration. Pure (no `window` access) so it can be unit tested.
 *
 * @module lib/workspace/workspace-persistence
 */

import { z } from 'zod'
import {
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  type PaneId,
  type PaneState,
  type WorkspaceState,
  type WorkspaceTab,
} from './types'
import { createInitialState } from './workspace-reducer'

/** localStorage key base. Scoped per instance by {@link workspaceStorageKey}. */
export const WORKSPACE_STORAGE_KEY_BASE = 'quilltap.workspace.layout'

/**
 * Per-instance storage key. The instance id keeps layouts from leaking between
 * instances sharing a browser origin; falls back to the unscoped base when no
 * instance id is available (the common single-instance case).
 */
export function workspaceStorageKey(instanceId?: string | null): string {
  return instanceId ? `${WORKSPACE_STORAGE_KEY_BASE}.${instanceId}` : WORKSPACE_STORAGE_KEY_BASE
}

const TAB_KINDS = [
  'home',
  'salon',
  'terminal',
  'document',
  'aurora',
  'prospero',
  'scriptorium',
  'settings',
  'files',
  'photos',
  'scenarios',
  'brahma',
  'wardrobe',
] as const

const WorkspaceTabSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(TAB_KINDS),
  payload: z.unknown().optional(),
  title: z.string(),
  icon: z.string().optional(),
  parentTabId: z.string().optional(),
})

const PaneStateSchema = z.object({
  order: z.array(z.string()),
  activeTabId: z.string().nullable(),
})

const WorkspaceStateSchema = z.object({
  tabs: z.record(z.string(), WorkspaceTabSchema),
  panes: z.object({
    left: PaneStateSchema,
    right: PaneStateSchema.nullable(),
  }),
  focusedPane: z.enum(['left', 'right']),
  splitRatio: z.number(),
})

export function serializeWorkspaceState(state: WorkspaceState): string {
  return JSON.stringify(state)
}

/** Parse + shape-validate. Returns `null` on malformed/incompatible payloads. */
export function deserializeWorkspaceState(raw: string | null | undefined): WorkspaceState | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = WorkspaceStateSchema.safeParse(parsed)
    if (!result.success) return null
    return result.data as WorkspaceState
  } catch {
    return null
  }
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio))
}

export interface PruneOptions {
  /** Returns whether a referenced chat still exists. Default: everything valid. */
  isChatValid?: (chatId: string) => boolean
}

/**
 * Drop dead tabs and re-normalize the layout:
 * - Salon/terminal/document tabs whose chat is invalid are removed.
 * - Child tabs (terminal/document) orphaned by a removed parent are removed.
 * - Pane orders are filtered to surviving tabs; active references repaired.
 * - An emptied right pane collapses; an emptied left pane is filled from the
 *   right; if everything is gone, falls back to a fresh home tab.
 */
export function pruneWorkspaceState(
  state: WorkspaceState,
  opts: PruneOptions,
  homeFallbackId: string
): WorkspaceState {
  const isChatValid = opts.isChatValid ?? (() => true)

  // 1. Tabs that survive on their own merits (chat existence).
  const surviving = new Set<string>()
  for (const tab of Object.values(state.tabs)) {
    let keep = true
    if (tab.kind === 'salon' || tab.kind === 'terminal' || tab.kind === 'document') {
      const chatId = (tab.payload as { chatId?: string } | undefined)?.chatId
      keep = Boolean(chatId) && isChatValid(chatId as string)
    }
    // Document tabs are now keyed by an open document id; drop pre-multi-doc
    // document tabs that lack one (the Salon re-opens proper per-document tabs
    // from the server on mount). Whether the specific document is still open is
    // reconciled by the Salon view, not here.
    if (keep && tab.kind === 'document') {
      const chatDocumentId = (tab.payload as { chatDocumentId?: string } | undefined)?.chatDocumentId
      keep = Boolean(chatDocumentId)
    }
    if (keep) surviving.add(tab.id)
  }

  // 2. Drop child tabs whose parent did not survive (fixpoint for chains).
  let changed = true
  while (changed) {
    changed = false
    for (const tab of Object.values(state.tabs)) {
      if (!surviving.has(tab.id)) continue
      if (tab.parentTabId && !surviving.has(tab.parentTabId)) {
        surviving.delete(tab.id)
        changed = true
      }
    }
  }

  // 3. Rebuild tabs map (surviving + real objects only).
  const tabs: Record<string, WorkspaceTab> = {}
  for (const id of surviving) {
    if (state.tabs[id]) tabs[id] = state.tabs[id]
  }

  // 4. Rebuild pane orders, keeping original order, dropping non-survivors and
  //    ids with no backing tab.
  const leftOrder = state.panes.left.order.filter((id) => tabs[id])
  const rightOrder = state.panes.right
    ? state.panes.right.order.filter((id) => tabs[id])
    : null

  // Any surviving tab not placed in a pane (corruption) → append to left.
  const placed = new Set<string>([...leftOrder, ...(rightOrder ?? [])])
  for (const id of Object.keys(tabs)) {
    if (!placed.has(id)) leftOrder.push(id)
  }

  const leftActive =
    state.panes.left.activeTabId && leftOrder.includes(state.panes.left.activeTabId)
      ? state.panes.left.activeTabId
      : leftOrder[0] ?? null
  let left: PaneState = { order: leftOrder, activeTabId: leftActive }

  let right: PaneState | null =
    rightOrder && rightOrder.length > 0
      ? {
          order: rightOrder,
          activeTabId:
            state.panes.right && state.panes.right.activeTabId && rightOrder.includes(state.panes.right.activeTabId)
              ? state.panes.right.activeTabId
              : rightOrder[0] ?? null,
        }
      : null

  let focusedPane: PaneId = state.focusedPane
  if (focusedPane === 'right' && !right) focusedPane = 'left'

  // Promote right→left if the left pane emptied.
  if (left.order.length === 0 && right && right.order.length > 0) {
    left = right
    right = null
    focusedPane = 'left'
  }

  // Everything gone — home fallback.
  if (left.order.length === 0 && (!right || right.order.length === 0)) {
    return createInitialState(homeFallbackId)
  }

  return {
    tabs,
    panes: { left, right },
    focusedPane,
    splitRatio: clampRatio(state.splitRatio),
  }
}

/**
 * One-shot hydrate: deserialize, prune dead tabs, and fall back to a fresh home
 * tab when there is nothing usable. `homeFallbackId` must be a fresh uuid.
 */
export function hydrateWorkspaceState(
  raw: string | null | undefined,
  opts: PruneOptions,
  homeFallbackId: string
): WorkspaceState {
  const parsed = deserializeWorkspaceState(raw)
  if (!parsed) return createInitialState(homeFallbackId)
  return pruneWorkspaceState(parsed, opts, homeFallbackId)
}
