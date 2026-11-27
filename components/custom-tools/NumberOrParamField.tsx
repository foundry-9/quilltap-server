'use client'

/**
 * NumberOrParamField — the reusable control at the heart of the Workbench.
 *
 * Every numeric field that accepts a `{ "$param": … }` reference (roll fields,
 * comparator operands) renders as one of these: a literal number input with a
 * toggle to parameter mode, where a select lists only the type-compatible
 * declared parameters. When no eligible parameter exists the toggle is
 * disabled with a hint — the schema's rules made visible, never violated.
 */

import { Icon } from '@/components/ui/icon'
import type { NumberOrParamValue } from '@/lib/pascal/tool-draft'
import { ParamRefSelect, RawRefBadge } from './chip-parts'

interface NumberOrParamFieldProps {
  value: NumberOrParamValue
  onChange: (value: NumberOrParamValue) => void
  /** Parameters eligible for reference (already type-filtered by the caller). */
  paramNames: string[]
  /** Placeholder shown while a literal is blank (e.g. the field's default). */
  placeholder?: string
  hasError?: boolean
  disabled?: boolean
  label: string
}

export function NumberOrParamField({
  value,
  onChange,
  paramNames,
  placeholder,
  hasError = false,
  disabled = false,
  label,
}: Readonly<NumberOrParamFieldProps>) {
  const noParams = paramNames.length === 0

  return (
    <div className="flex items-center gap-1">
      {value.kind === 'literal' ? (
        <input
          type="number"
          value={value.text}
          onChange={(e) => onChange({ kind: 'literal', text: e.target.value })}
          placeholder={placeholder}
          disabled={disabled}
          className={`qt-input w-24 ${hasError ? 'qt-input-error' : ''}`}
          aria-label={label}
          step="any"
        />
      ) : value.kind === 'state' ? (
        <RawRefBadge
          hasError={hasError}
          title="This field draws from persistent state. Edit $state references in the raw JSON, or swap to a literal."
        >
          $state: {value.path} → {value.fallback}
        </RawRefBadge>
      ) : value.kind === 'inventory' ? (
        <RawRefBadge
          hasError={hasError}
          title="This field draws from an object the rolling character carries. Edit $inventory references in the raw JSON, or swap to a literal."
        >
          $inventory: {value.path} → {value.fallback}
        </RawRefBadge>
      ) : (
        <ParamRefSelect
          value={value.name}
          names={paramNames}
          onChange={(name) => onChange({ kind: 'param', name })}
          disabled={disabled}
          ariaLabel={`${label} parameter`}
          hasError={hasError}
        />
      )}
      <button
        type="button"
        onClick={() =>
          onChange(
            value.kind === 'literal'
              ? { kind: 'param', name: paramNames[0] ?? '' }
              : { kind: 'literal', text: '' }
          )
        }
        disabled={disabled || (value.kind === 'literal' && noParams)}
        className="qt-button qt-button-ghost qt-button-sm"
        title={
          value.kind === 'literal'
            ? noParams
              ? 'Declare a numeric parameter first'
              : 'Use a parameter instead of a number'
            : value.kind === 'state' || value.kind === 'inventory'
              ? `Replace this $${value.kind} reference with a literal number`
              : 'Use a literal number instead'
        }
        aria-label={`Toggle ${label} between a literal and a parameter reference`}
      >
        <Icon name="swap" className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export default NumberOrParamField
