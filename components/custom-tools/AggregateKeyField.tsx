'use client'

/**
 * AggregateKeyField — the key box of an `inventoryAggregate` chip, with a
 * small Insert-key helper that fills in a `<scope>.<field>` skeleton.
 *
 * Shared by the gate and the outcome table: the key is literal in both, so
 * the widget is the same.
 */

import { AGGREGATE_FOLDS, AGGREGATE_SCOPES } from '@/lib/pascal/inventory-aggregate'

interface AggregateKeyFieldProps {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}

/** Every skeleton the helper offers, in reading order. */
const SKELETONS: string[] = AGGREGATE_SCOPES.flatMap((scope) => [
  `${scope}.count`,
  `${scope}.names`,
  `${scope}.titles`,
  `${scope}.metadata.`,
  ...AGGREGATE_FOLDS.map((fold) => `${scope}.metadata.<key>.${fold}`),
])

const TITLE =
  'One attribute across everything in a scope. Scopes: equipped (in this chat), owned (in their own vault, ' +
  'equipped or not), reachable (everything they can see). Fields: count, names, titles, metadata.<key> (a list ' +
  'of the objects’ values), or metadata.<key>.min / .max / .sum / .count (a number). A list matches = when any ' +
  'entry does; ordering needs a fold.'

export function AggregateKeyField({ value, onChange, disabled = false }: Readonly<AggregateKeyFieldProps>) {
  return (
    <>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="equipped.metadata.toolVersion.max"
        disabled={disabled}
        className={`qt-input w-56 text-sm ${value.trim() === '' ? 'qt-input-error' : ''}`}
        aria-label="Inventory aggregate key"
        title={TITLE}
      />
      <select
        value=""
        onChange={(e) => {
          // A fold skeleton keeps whatever key is already typed, if any.
          const skeleton = e.target.value
          if (!skeleton) return
          const typedKey = /^[a-z]+\.metadata\.(.+?)(?:\.(?:min|max|sum|count))?$/.exec(value.trim())?.[1]
          onChange(skeleton.replace('<key>', typedKey ?? 'key'))
        }}
        disabled={disabled}
        className="qt-select qt-select-sm w-24 shrink-0"
        aria-label="Insert an aggregate key"
        title="Fill the box with a scope and a field; type the metadata key yourself."
      >
        <option value="">Insert key…</option>
        {SKELETONS.map((skeleton) => (
          <option key={skeleton} value={skeleton}>
            {skeleton}
          </option>
        ))}
      </select>
    </>
  )
}

export default AggregateKeyField
