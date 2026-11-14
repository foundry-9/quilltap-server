'use client'

/**
 * ConsoleContextDialog
 *
 * "Add to context" for a Writing Assistant conversation: pick conversations
 * (Salon and autonomous, searched by title, showing cast and last activity),
 * projects, document stores and Quilltap General. Returns the picked items
 * with the labels the lists already carry, so the caller's chips need no read
 * of their own.
 *
 * @module components/brahma-console/ConsoleContextDialog
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BaseModal } from '@/components/ui/BaseModal'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useProjectsQuery } from '@/lib/hooks/use-projects'
import { useDocumentStoresQuery } from '@/lib/hooks/use-document-stores'
import { contextItemKey } from './console-context-chips'
import type { PendingContextItem } from './hooks/useBrahmaConsoleSession'

interface ChatRow {
  id: string
  title: string
  chatType: string
  lastMessageAt: string | null
  updatedAt: string
  participants: Array<{ character: { name?: string | null } | null; removedAt?: string | null }>
}

interface NamedRow {
  id: string
  name: string
  storeType?: string
  enabled?: boolean
}

interface ConsoleContextDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Keys already in the context (shown checked and disabled). */
  existingKeys: ReadonlySet<string>
  onAdd: (items: PendingContextItem[]) => void
}

function castOf(chat: ChatRow): string {
  const names = chat.participants
    .map(p => p.character?.name)
    .filter((n): n is string => !!n)
  return names.join(', ')
}

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

export function ConsoleContextDialog({ isOpen, onClose, existingKeys, onAdd }: ConsoleContextDialogProps) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [picked, setPicked] = useState<Map<string, PendingContextItem>>(new Map())

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const chats = useQuery({
    queryKey: queryKeys.chats.list({ includeAutonomous: true, q: debounced }),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ includeAutonomous: 'true', limit: '50' })
      if (debounced) params.set('q', debounced)
      return apiFetch<{ chats: ChatRow[] }>(`/api/v1/chats?${params.toString()}`, { signal })
    },
    enabled: isOpen,
  })
  const projects = useProjectsQuery<NamedRow>({ enabled: isOpen })
  const stores = useDocumentStoresQuery<NamedRow>({ enabled: isOpen })

  const conversationRows = (chats.data?.chats ?? []).filter(c => c.chatType === 'salon' || c.chatType === 'autonomous')
  const projectRows = [...(projects.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const storeRows = [...(stores.data ?? [])]
    .filter(s => s.enabled !== false)
    .sort((a, b) => a.name.localeCompare(b.name))

  const toggle = (item: PendingContextItem) => {
    setPicked(prev => {
      const next = new Map(prev)
      const key = contextItemKey(item.ref)
      if (next.has(key)) next.delete(key)
      else next.set(key, item)
      return next
    })
  }

  const isChecked = (key: string) => existingKeys.has(key) || picked.has(key)

  const close = () => {
    setPicked(new Map())
    setQuery('')
    onClose()
  }

  const confirm = () => {
    onAdd([...picked.values()])
    setPicked(new Map())
    setQuery('')
    onClose()
  }

  const row = (key: string, item: PendingContextItem, label: string, detail?: string) => {
    const already = existingKeys.has(key)
    const id = `console-context-${key.replace(/[^a-z0-9-]/gi, '-')}`
    return (
      <li key={key} className="flex items-start gap-2 py-1">
        <input
          id={id}
          type="checkbox"
          className="mt-1"
          checked={isChecked(key)}
          disabled={already}
          onChange={() => toggle(item)}
        />
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          <span className="block truncate text-sm">{label}{already ? ' (already named)' : ''}</span>
          {detail && <span className="block truncate text-xs qt-text-secondary">{detail}</span>}
        </label>
      </li>
    )
  }

  const generalKey = contextItemKey({ kind: 'general' })

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={close}
      title="Add to the Context"
      subtitle="Name the sources the piece should draw upon. The engine consults what it needs; nothing is read in advance."
      maxWidth="2xl"
      overlayClassName="qt-console-modal-layer"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="qt-button-secondary" onClick={close}>Cancel</button>
          <button type="button" className="qt-button-primary" onClick={confirm} disabled={picked.size === 0}>
            Add {picked.size > 0 ? picked.size : ''}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <section aria-labelledby="console-context-conversations">
          <h3 id="console-context-conversations" className="qt-label mb-1">Conversations</h3>
          <label htmlFor="console-context-search" className="sr-only">Search conversations by title</label>
          <input
            id="console-context-search"
            type="search"
            className="qt-input w-full mb-2"
            placeholder="Search by title…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {chats.isLoading ? (
            <p className="text-sm qt-text-secondary">Leafing through the ledgers…</p>
          ) : conversationRows.length === 0 ? (
            <p className="text-sm qt-text-secondary">No conversation answers to that description.</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {conversationRows.map(chat => {
                const ref = { kind: 'chat' as const, id: chat.id }
                const cast = castOf(chat)
                const when = formatWhen(chat.lastMessageAt ?? chat.updatedAt)
                const detail = [cast, when && `last stirred ${when}`].filter(Boolean).join(' · ')
                return row(contextItemKey(ref), { ref, label: chat.title || 'Untitled conversation', detail: cast || undefined }, chat.title || 'Untitled conversation', detail)
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="console-context-projects">
          <h3 id="console-context-projects" className="qt-label mb-1">Projects</h3>
          {projectRows.length === 0 ? (
            <p className="text-sm qt-text-secondary">{projects.isLoading ? 'Fetching the projects…' : 'No projects on the books.'}</p>
          ) : (
            <ul className="max-h-40 overflow-y-auto">
              {projectRows.map(p => {
                const ref = { kind: 'project' as const, id: p.id }
                return row(contextItemKey(ref), { ref, label: p.name }, p.name)
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="console-context-stores">
          <h3 id="console-context-stores" className="qt-label mb-1">Document stores</h3>
          {storeRows.length === 0 ? (
            <p className="text-sm qt-text-secondary">{stores.isLoading ? 'Fetching the stores…' : 'No document stores to hand.'}</p>
          ) : (
            <ul className="max-h-40 overflow-y-auto">
              {storeRows.map(s => {
                const ref = { kind: 'store' as const, id: s.id }
                return row(
                  contextItemKey(ref),
                  { ref, label: s.name },
                  s.name,
                  s.storeType === 'character' ? 'character vault' : undefined,
                )
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="console-context-general">
          <h3 id="console-context-general" className="qt-label mb-1">Quilltap General</h3>
          <ul>
            {row(generalKey, { ref: { kind: 'general' }, label: 'Quilltap General' }, 'Quilltap General', 'The instance-wide store')}
          </ul>
        </section>
      </div>
    </BaseModal>
  )
}
