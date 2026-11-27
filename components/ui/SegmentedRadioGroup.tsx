'use client'

/**
 * SegmentedRadioGroup — a row of buttons of which exactly one is chosen,
 * drawn as the caller likes and behaving as the WAI-ARIA radio group pattern
 * asks: one tab stop (the chosen option, or the first that can be chosen),
 * and the arrow keys, Home and End move to another option and choose it.
 * Clicking an option chooses it, as it always did.
 *
 * @module components/ui/SegmentedRadioGroup
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface SegmentedOption<V extends string> {
  value: V
  label: ReactNode
  title?: string
  disabled?: boolean
}

interface SegmentedRadioGroupProps<V extends string> {
  options: readonly SegmentedOption<V>[]
  /** The chosen option's value; null when none is. */
  value: V | null
  /** Called when an option is clicked or reached with the keyboard. */
  onSelect: (value: V) => void
  ariaLabel: string
  /** Disables every option. */
  disabled?: boolean
  /** Classes on the group. */
  className?: string
  /** Classes on one option, by whether it is the chosen one. */
  optionClassName: (value: V, selected: boolean) => string
}

/** The usual look: joined buttons, the chosen one primary. */
export function segmentedButtonClass(size: 'xs' | 'sm'): (value: string, selected: boolean) => string {
  const spacing = size === 'xs' ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm'
  return (_value, selected) => `${spacing} ${selected ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'}`
}

const NEXT_KEYS =new Set(['ArrowRight', 'ArrowDown'])
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp'])

export function SegmentedRadioGroup<V extends string>({
  options,
  value,
  onSelect,
  ariaLabel,
  disabled = false,
  className,
  optionClassName,
}: Readonly<SegmentedRadioGroupProps<V>>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = (i: number) => !disabled && !options[i]?.disabled
  const chosen = options.findIndex((option) => option.value === value)
  const tabStop = chosen >= 0 && enabled(chosen) ? chosen : options.findIndex((_, i) => enabled(i))

  const move = (from: number, target: 'next' | 'previous' | 'first' | 'last') => {
    const count = options.length
    const order =
      target === 'first' || target === 'last'
        ? Array.from({ length: count }, (_, k) => (target === 'first' ? k : count - 1 - k))
        : Array.from({ length: count - 1 }, (_, k) => (target === 'next' ? from + 1 + k : from - 1 - k + count) % count)
    const to = order.find((i) => enabled(i))
    if (to === undefined || to === from) return
    buttons.current[to]?.focus()
    onSelect(options[to].value)
  }

  const onKeyDown = (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    let target: 'next' | 'previous' | 'first' | 'last' | null = null
    if (NEXT_KEYS.has(e.key)) target = 'next'
    else if (PREVIOUS_KEYS.has(e.key)) target = 'previous'
    else if (e.key === 'Home') target = 'first'
    else if (e.key === 'End') target = 'last'
    if (!target) return
    e.preventDefault()
    move(index, target)
  }

  return (
    <div className={className} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const selected = index === chosen
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttons.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabStop ? 0 : -1}
            className={optionClassName(option.value, selected)}
            onClick={() => onSelect(option.value)}
            onKeyDown={onKeyDown(index)}
            disabled={disabled || option.disabled}
            title={option.title}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedRadioGroup
