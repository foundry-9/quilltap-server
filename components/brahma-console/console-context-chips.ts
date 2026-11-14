/**
 * Writing Assistant context chips — the one shape the context bar draws,
 * built either from the launcher's pending picks or from the server's
 * resolved context (`GET /api/v1/brahma-console/[id]`). The client never
 * resolves a name itself.
 *
 * Client-safe.
 *
 * @module components/brahma-console/console-context-chips
 */

import type { ConsoleContextRef } from '@/lib/schemas/chat.types'
import type { ResolvedConsoleContext } from '@/lib/brahma-console/writing-context'
import type { PendingContextItem } from './hooks/useBrahmaConsoleSession'

export interface ContextChip {
  key: string
  ref: ConsoleContextRef
  label: string
  /** The target is gone: drawn struck through, still removable. */
  missing: boolean
  /** Derived, non-removable vault chips under a conversation. */
  derived: Array<{ key: string; label: string; archived: boolean }>
}

/** A stable key for a ref. */
export function contextItemKey(ref: ConsoleContextRef): string {
  return ref.kind === 'general' ? 'general' : `${ref.kind}:${ref.id}`
}

/** Chips for the launcher, from what the dialog picked. */
export function chipsFromPending(items: readonly PendingContextItem[]): ContextChip[] {
  return items.map(item => ({
    key: contextItemKey(item.ref),
    ref: item.ref,
    label: item.label,
    missing: false,
    derived: [],
  }))
}

/** Chips for a conversation, in stored order, from the resolved context. */
export function chipsFromResolved(
  refs: readonly ConsoleContextRef[],
  resolved: ResolvedConsoleContext | null,
): ContextChip[] {
  const missingKeys = new Set((resolved?.missing ?? []).map(contextItemKey))
  return refs.map(ref => {
    const key = contextItemKey(ref)
    const base: ContextChip = { key, ref, label: 'Unknown source', missing: missingKeys.has(key), derived: [] }
    if (!resolved) return base
    switch (ref.kind) {
      case 'chat': {
        const conv = resolved.conversations.find(c => c.ref.id === ref.id)
        if (!conv) return { ...base, label: 'A conversation no longer on the books', missing: true }
        return {
          ...base,
          label: conv.title,
          derived: conv.cast.map(member => ({
            key: `${key}:${member.characterId}`,
            label: member.archived
              ? `${member.name} (archived)`
              : member.vaultStoreName ? `${member.name} — vault` : member.name,
            archived: member.archived,
          })),
        }
      }
      case 'project': {
        const project = resolved.projects.find(p => p.ref.id === ref.id)
        return project ? { ...base, label: project.name } : { ...base, label: 'A project no longer on the books', missing: true }
      }
      case 'store': {
        const store = resolved.stores.find(s => s.ref.id === ref.id)
        if (store) return { ...base, label: store.name }
        // Quilltap General named as a store resolves as General.
        if (resolved.general && !missingKeys.has(key)) return { ...base, label: resolved.general.storeName }
        return { ...base, label: 'A store no longer on the books', missing: true }
      }
      case 'general':
        return resolved.general
          ? { ...base, label: resolved.general.storeName }
          : { ...base, label: 'Quilltap General', missing: true }
    }
  })
}
