'use client'

/**
 * Wear history — the read-only foot of the wardrobe item editor.
 *
 * Shows the item's wear-ledger breakdown: when it was created, how many times
 * it has been put on, first and last wear (linking the chat it was last worn
 * in, when that chat still exists), and who has worn it. Fetched when the
 * editor opens, via the item route's `?action=wear-history`.
 *
 * Edit mode only — a new item has no history. For a composite, a one-line
 * note explains that wearing the outfit also credits its garments.
 *
 * Design of record: docs/developer/features/wardrobe-wear-ledger.md §5.4
 *
 * @module components/wardrobe/wardrobe-item-editor/WardrobeWearHistorySection
 */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { formatDate } from '@/lib/format-time'
import { formatWornWhen } from '@/lib/wardrobe/wear-display'
import type { WardrobeWearHistory } from '@/lib/schemas/wardrobe-wear.types'

/** The `?action=wear-history` response. */
export interface WardrobeWearHistoryResponse {
  history: WardrobeWearHistory
  wearers: Array<{ characterId: string | null; name: string; avatarUrl: string | null }>
  lastWornChat: { id: string; title: string } | null
}

interface WardrobeWearHistorySectionProps {
  itemId: string
  /** The item's own GET URL; `?action=wear-history` is appended. */
  itemUrl: string
  /** The item's `createdAt` (frontmatter). */
  createdAt?: string | null
  /** True for an outfit bundle (has components). */
  isComposite: boolean
}

function relative(value: string | null | undefined): string {
  return formatWornWhen(value)
}

export function WardrobeWearHistorySection({
  itemId,
  itemUrl,
  createdAt,
  isComposite,
}: WardrobeWearHistorySectionProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.wardrobe.wearHistory(itemId, itemUrl),
    queryFn: ({ signal }) =>
      apiFetch<WardrobeWearHistoryResponse>(`${itemUrl}?action=wear-history`, { signal }),
    // Opened rarely and always wanted current: a wear may have landed since.
    staleTime: 0,
  })

  const history = data?.history
  const names = new Map(
    (data?.wearers ?? []).map((w) => [w.characterId ?? '', w] as const),
  )

  const rows: Array<{ label: string; value: React.ReactNode }> = []
  if (createdAt) rows.push({ label: 'Created', value: formatDate(createdAt) })
  if (history) {
    rows.push({ label: 'Times worn', value: String(history.wearCount) })
    if (history.wearCount > 0) {
      rows.push({ label: 'First worn', value: formatDate(history.firstWornAt) })
      rows.push({
        label: 'Last worn',
        value: (
          <>
            {formatDate(history.lastWornAt)}
            {data?.lastWornChat ? (
              <>
                , in{' '}
                <Link href={`/salon/${data.lastWornChat.id}`} className="qt-link">
                  “{data.lastWornChat.title}”
                </Link>
              </>
            ) : history.lastWornChatId ? (
              ', in a chat since deleted'
            ) : null}
          </>
        ),
      })
    }
  }

  return (
    <section aria-labelledby={`wear-history-${itemId}`} className="border-t qt-border-default pt-4">
      <h3 id={`wear-history-${itemId}`} className="qt-label mb-2">
        Wear history
      </h3>

      {isLoading ? (
        <p className="qt-text-xs qt-text-secondary">Consulting the ledger…</p>
      ) : isError ? (
        <p className="qt-text-xs qt-text-secondary">The wear ledger could not be read just now.</p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="qt-text-secondary">{row.label}</dt>
                <dd className="text-foreground">{row.value}</dd>
              </div>
            ))}
            {history && history.wearers.length > 0 && (
              <div className="contents">
                <dt className="qt-text-secondary">Worn by</dt>
                <dd>
                  <ul className="space-y-1">
                    {history.wearers.map((w) => {
                      const who = names.get(w.characterId ?? '')
                      const name =
                        who?.name ??
                        (w.characterId === null ? 'Unattributed' : 'A departed character')
                      return (
                        <li
                          key={w.characterId ?? 'unattributed'}
                          className="flex items-center gap-2 text-foreground"
                        >
                          {who?.avatarUrl ? (
                            <img
                              src={who.avatarUrl}
                              alt=""
                              className="w-5 h-5 rounded-full object-cover qt-bg-muted border qt-border-default flex-shrink-0"
                            />
                          ) : (
                            <span
                              aria-hidden
                              className="w-5 h-5 rounded-full qt-bg-muted border qt-border-default flex-shrink-0"
                            />
                          )}
                          <span className="min-w-0 break-words">{name}</span>
                          <span className="qt-text-xs qt-text-secondary">
                            {w.wearCount}×, last {relative(w.lastWornAt)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
          {isComposite && (
            <p className="mt-2 qt-text-xs qt-text-secondary">
              Wearing this outfit also counts a wear for each garment it put on.
            </p>
          )}
        </>
      )}
    </section>
  )
}
