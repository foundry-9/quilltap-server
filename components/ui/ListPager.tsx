'use client'

/**
 * Previous / Next paging for a list that fetches one page at a time — the
 * replacement for an infinite scroller that grows without end as you reach
 * the bottom. Renders nothing for a single page.
 *
 * @module components/ui/ListPager
 */

export interface ListPagerProps {
  /** Zero-based current page. */
  page: number
  /** Total items across every page. */
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  /** Disable both buttons (a fetch in flight). */
  disabled?: boolean
  /** What the list holds, for the accessible label ("conversations"). */
  noun: string
}

export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function ListPager({ page, total, pageSize, onPageChange, disabled = false, noun }: ListPagerProps) {
  const pageCount = pageCountOf(total, pageSize)
  if (pageCount <= 1) return null
  const first = page * pageSize + 1
  const last = Math.min(total, (page + 1) * pageSize)

  return (
    <nav aria-label={`Pages of ${noun}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
      <button
        type="button"
        className="qt-button-secondary qt-button-sm"
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || page <= 0}
      >
        ← Previous
      </button>
      <span className="qt-text-small qt-text-secondary" aria-live="polite">
        {first}–{last} of {total} · page {page + 1} of {pageCount}
      </span>
      <button
        type="button"
        className="qt-button-secondary qt-button-sm"
        onClick={() => onPageChange(page + 1)}
        disabled={disabled || page >= pageCount - 1}
      >
        Next →
      </button>
    </nav>
  )
}
