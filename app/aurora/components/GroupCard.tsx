'use client'

/**
 * Group Card
 *
 * Displays a single group with member count and actions.
 */

import Link from 'next/link'
import type { Group } from '../types'

interface GroupCardProps {
  group: Group
  onClick: (e: React.MouseEvent) => void
  onDelete: () => void
}

/**
 * Users icon for groups without custom icons
 */
function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 8.048M12 4.354v8.048m-6.598-4.024A2 2 0 105.5 8.354m3.902-3.024A2 2 0 1110.5 8.354m6.598 4.024A2 2 0 1018.5 12.378m-3.902-3.024A2 2 0 1114.5 12.378" />
    </svg>
  )
}

/**
 * Trash icon for delete button
 */
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

export function GroupCard({ group, onClick, onDelete }: GroupCardProps) {
  return (
    <div
      className="qt-entity-card cursor-pointer hover:qt-border-primary/50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
            style={{ backgroundColor: group.color || 'var(--muted)' }}
          >
            {group.icon || <UsersIcon className="w-5 h-5 qt-text-secondary" />}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{group.name}</h2>
            <p className="qt-text-small">
              {group.memberCount ?? 0} member{group.memberCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {group.description && (
        <p className="line-clamp-2 qt-text-small mb-4">{group.description}</p>
      )}

      <div className="qt-entity-card-actions flex gap-2">
        <Link
          href={`/aurora/groups/${group.id}`}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-sm transition hover:qt-bg-primary/90"
          title="Edit group"
        >
          Edit
        </Link>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="qt-button-destructive qt-shadow-sm"
          title="Delete group"
        >
          <TrashIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
