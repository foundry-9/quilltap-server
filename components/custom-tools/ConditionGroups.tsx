'use client'

/**
 * ConditionGroups — the AND / OR layout shared by the gate and the outcome
 * table.
 *
 * A chip list is flat in the draft, each chip carrying how it joins the one
 * before it. Here it is drawn as lines: the chips of one group share a line,
 * an OR starts the next, and a hairline separates them — so "a AND b OR a AND
 * c" reads as two lines without a parenthesis in sight. The joiner between two
 * chips is a two-state toggle; flipping it splits or merges lines.
 */

import { Fragment, type ReactNode } from 'react'
import { groupsOf, type ConditionJoiner } from '@/lib/pascal/tool-draft'

interface JoinerToggleProps {
  joiner: ConditionJoiner
  onChange: (next: ConditionJoiner) => void
  disabled?: boolean
}

/** The AND / OR between two chips. */
export function JoinerToggle({ joiner, onChange, disabled = false }: Readonly<JoinerToggleProps>) {
  return (
    <button
      type="button"
      className="qt-button qt-button-ghost qt-button-sm font-mono text-xs"
      onClick={() => onChange(joiner === 'or' ? 'and' : 'or')}
      disabled={disabled}
      aria-label={joiner === 'or' ? 'Joined by OR — switch to AND' : 'Joined by AND — switch to OR'}
      title={
        joiner === 'or'
          ? 'OR starts a new line: any line that holds will do. Click to fold it into the line above.'
          : 'AND keeps this test on the same line: every test on a line must hold. Click to start a new line.'
      }
    >
      {joiner === 'or' ? 'OR' : 'AND'}
    </button>
  )
}

interface ConditionGroupsProps<C extends { id: string; joiner?: ConditionJoiner }> {
  conditions: readonly C[]
  disabled?: boolean
  /** Set one chip's joiner. */
  onJoinerChange: (id: string, joiner: ConditionJoiner) => void
  /** Render one chip. */
  renderChip: (condition: C) => ReactNode
}

/** Draw a chip list as its lines, with a toggle before every chip but the first. */
export function ConditionGroups<C extends { id: string; joiner?: ConditionJoiner }>({
  conditions,
  disabled = false,
  onJoinerChange,
  renderChip,
}: Readonly<ConditionGroupsProps<C>>) {
  return (
    <>
      {groupsOf(conditions).map((group, g) => (
        <div key={group[0].id} className={g > 0 ? 'border-t qt-border-default pt-1 mt-1' : ''}>
          <div className="flex items-center gap-2 flex-wrap">
            {group.map((condition, i) => (
              <Fragment key={condition.id}>
                {(g > 0 || i > 0) && (
                  <JoinerToggle
                    joiner={g > 0 && i === 0 ? 'or' : 'and'}
                    onChange={(next) => onJoinerChange(condition.id, next)}
                    disabled={disabled}
                  />
                )}
                {renderChip(condition)}
              </Fragment>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

export default ConditionGroups
