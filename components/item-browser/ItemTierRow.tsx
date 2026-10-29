'use client'

/**
 * A tier row in a character's browser: a shared store the character borrows
 * from (a group, a project, Quilltap General), entered like a folder.
 *
 * @module components/item-browser/ItemTierRow
 */

import { Icon } from '@/components/ui/icon'

export interface ItemTierRowProps {
  label: string
  scope: 'general' | 'project' | 'group' | 'character'
  itemCount: number
  onOpen: () => void
  /** `data-testid`, e.g. `wardrobe-tier-row`. */
  testId: string
  countNoun?: string
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function ItemTierRow({ label, scope, itemCount, onOpen, testId, countNoun = 'item' }: ItemTierRowProps) {
  return (
    <button
      type="button"
      className="qt-card-interactive w-full py-2 px-3 flex items-center gap-2 text-left"
      onClick={onOpen}
      data-testid={testId}
    >
      <Icon name="folder" className="w-4 h-4 qt-text-secondary" />
      <span className="text-sm text-foreground flex-1 min-w-0 truncate">{label}</span>
      <span className="qt-badge qt-badge-wardrobe-shared">
        {scope === 'general' ? 'Shared' : scope === 'project' ? 'Project' : 'Group'}
      </span>
      <span className="qt-text-xs qt-text-secondary">{plural(itemCount, countNoun)}</span>
    </button>
  )
}
