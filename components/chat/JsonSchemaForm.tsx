'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'

/**
 * JSON Schema property definition (subset of JSON Schema we support)
 */
interface SchemaProperty {
  type?: string
  description?: string
  enum?: (string | number)[]
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  oneOf?: SchemaProperty[]
}

interface JsonSchemaFormProps {
  /** The JSON Schema parameters object (type: 'object' with properties) */
  schema: {
    type: string
    properties: Record<string, SchemaProperty>
    required?: string[]
  }
  /** Current form values */
  values: Record<string, unknown>
  /** Called when any value changes */
  onChange: (values: Record<string, unknown>) => void
  /** Called when validation state changes */
  onValidChange: (isValid: boolean) => void
}

/**
 * Renders form fields dynamically from a JSON Schema `parameters` object.
 *
 * Supports: string, number, integer, boolean, string+enum, oneOf (as radio),
 * and falls back to a JSON textarea for object/array types.
 */
export default function JsonSchemaForm({ schema, values, onChange, onValidChange }: JsonSchemaFormProps) {
  const [includedOptionals, setIncludedOptionals] = useState<Set<string>>(() => {
    // Pre-include any optional fields that have default values or existing values
    const included = new Set<string>()
    const required = new Set(schema.required || [])
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (!required.has(key) && (prop.default !== undefined || values[key] !== undefined)) {
        included.add(key)
      }
    }
    return included
  })

  const required = useMemo(() => new Set(schema.required || []), [schema.required])

  // Validate whenever values change
  useEffect(() => {
    const isValid = validateAll()
    onValidChange(isValid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, includedOptionals])

  const validateAll = useCallback((): boolean => {
    for (const key of required) {
      const val = values[key]
      if (val === undefined || val === null || val === '') {
        return false
      }
    }
    // Check number bounds for included fields
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (!required.has(key) && !includedOptionals.has(key)) continue
      const val = values[key]
      if ((prop.type === 'number' || prop.type === 'integer') && val !== undefined && val !== '') {
        const num = Number(val)
        if (isNaN(num)) return false
        if (prop.minimum !== undefined && num < prop.minimum) return false
        if (prop.maximum !== undefined && num > prop.maximum) return false
      }
    }
    return true
  }, [values, schema.properties, required, includedOptionals])

  const handleChange = useCallback((key: string, value: unknown) => {
    const newValues = { ...values, [key]: value }
    onChange(newValues)
  }, [values, onChange])

  const handleToggleOptional = useCallback((key: string, include: boolean) => {
    setIncludedOptionals(prev => {
      const next = new Set(prev)
      if (include) {
        next.add(key)
        // Set default value if available
        const prop = schema.properties[key]
        if (prop?.default !== undefined && values[key] === undefined) {
          handleChange(key, prop.default)
        }
      } else {
        next.delete(key)
        // Remove the value
        const newValues = { ...values }
        delete newValues[key]
        onChange(newValues)
      }
      return next
    })
  }, [schema.properties, values, onChange, handleChange])

  const renderField = (key: string, prop: SchemaProperty, isRequired: boolean) => {
    const isIncluded = isRequired || includedOptionals.has(key)
    const currentValue = values[key]

    return (
      <div key={key} className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          {!isRequired && (
            <input
              type="checkbox"
              checked={isIncluded}
              onChange={(e) => handleToggleOptional(key, e.target.checked)}
              className="qt-checkbox"
              id={`include-${key}`}
            />
          )}
          <label
            htmlFor={isRequired ? `field-${key}` : `include-${key}`}
            className="text-sm font-medium qt-text"
          >
            {key}
            {isRequired && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        </div>

        {prop.description && (
          <p className="text-xs qt-text-secondary mb-1.5">{prop.description}</p>
        )}

        {isIncluded && renderInput(key, prop, currentValue)}
      </div>
    )
  }

  const renderInput = (key: string, prop: SchemaProperty, currentValue: unknown) => {
    // String enum → select dropdown
    if (prop.type === 'string' && prop.enum) {
      return (
        <select
          id={`field-${key}`}
          value={String(currentValue ?? prop.default ?? '')}
          onChange={(e) => handleChange(key, e.target.value)}
          className="qt-select w-full text-sm"
        >
          <option value="">Select...</option>
          {prop.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      )
    }

    // Boolean → checkbox
    if (prop.type === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-sm qt-text">
          <input
            type="checkbox"
            checked={Boolean(currentValue ?? prop.default ?? false)}
            onChange={(e) => handleChange(key, e.target.checked)}
            className="qt-checkbox"
          />
          <span>Enabled</span>
        </label>
      )
    }

    // Number/integer → number input
    if (prop.type === 'number' || prop.type === 'integer') {
      return (
        <input
          id={`field-${key}`}
          type="number"
          value={currentValue !== undefined ? String(currentValue) : (prop.default !== undefined ? String(prop.default) : '')}
          onChange={(e) => {
            const val = e.target.value
            if (val === '') {
              handleChange(key, undefined)
            } else {
              handleChange(key, prop.type === 'integer' ? parseInt(val, 10) : parseFloat(val))
            }
          }}
          min={prop.minimum}
          max={prop.maximum}
          step={prop.type === 'integer' ? 1 : 'any'}
          className="qt-input w-full text-sm"
          placeholder={prop.default !== undefined ? `Default: ${prop.default}` : undefined}
        />
      )
    }

    // oneOf → radio group for variant selection
    if (prop.oneOf && prop.oneOf.length > 0) {
      return <OneOfField propKey={key} variants={prop.oneOf} value={currentValue} onChange={handleChange} />
    }

    // Object or array → JSON textarea
    if (prop.type === 'object' || prop.type === 'array') {
      const strVal = currentValue !== undefined ? (typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue, null, 2)) : ''
      return (
        <textarea
          id={`field-${key}`}
          value={strVal}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value)
              handleChange(key, parsed)
            } catch {
              // Keep raw string while user is typing
              handleChange(key, e.target.value)
            }
          }}
          rows={4}
          className="qt-input w-full text-sm font-mono"
          placeholder="Enter valid JSON..."
        />
      )
    }

    // Default: string → text input or textarea for long descriptions
    const isLongText = prop.description?.toLowerCase().includes('description') ||
      prop.description?.toLowerCase().includes('content') ||
      prop.description?.toLowerCase().includes('body') ||
      (prop.maxLength && prop.maxLength > 500)

    if (isLongText) {
      return (
        <textarea
          id={`field-${key}`}
          value={String(currentValue ?? prop.default ?? '')}
          onChange={(e) => handleChange(key, e.target.value)}
          rows={3}
          maxLength={prop.maxLength}
          className="qt-input w-full text-sm"
          placeholder={prop.default !== undefined ? `Default: ${prop.default}` : undefined}
        />
      )
    }

    return (
      <input
        id={`field-${key}`}
        type="text"
        value={String(currentValue ?? prop.default ?? '')}
        onChange={(e) => handleChange(key, e.target.value)}
        maxLength={prop.maxLength}
        className="qt-input w-full text-sm"
        placeholder={prop.default !== undefined ? `Default: ${prop.default}` : undefined}
      />
    )
  }

  // Sort: required fields first, then optional
  const sortedKeys = Object.keys(schema.properties).sort((a, b) => {
    const aReq = required.has(a) ? 0 : 1
    const bReq = required.has(b) ? 0 : 1
    return aReq - bReq
  })

  return (
    <div className="space-y-1">
      {sortedKeys.map((key) =>
        renderField(key, schema.properties[key], required.has(key))
      )}
    </div>
  )
}

/**
 * Handles oneOf variant selection with a radio group
 */
function OneOfField({
  propKey,
  variants,
  value,
  onChange,
}: {
  propKey: string
  variants: SchemaProperty[]
  value: unknown
  onChange: (key: string, value: unknown) => void
}) {
  // Determine which variant is currently selected
  const [selectedVariant, setSelectedVariant] = useState<number>(() => {
    if (value === undefined) return 0
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]
      if (v.type === 'string' && typeof value === 'string') return i
      if (v.type === 'integer' && typeof value === 'number') return i
      if (v.type === 'number' && typeof value === 'number') return i
    }
    return 0
  })

  const activeVariant = variants[selectedVariant]

  const getVariantLabel = (v: SchemaProperty, idx: number): string => {
    if (v.enum) return v.enum.join(' / ')
    if (v.type === 'integer' || v.type === 'number') return `Number${v.minimum !== undefined ? ` (${v.minimum}-${v.maximum ?? '...'})` : ''}`
    if (v.type === 'string') return 'Text'
    return `Option ${idx + 1}`
  }

  return (
    <div className="space-y-2">
      {variants.length > 1 && (
        <div className="flex gap-3 flex-wrap">
          {variants.map((v, idx) => (
            <label key={idx} className="flex items-center gap-1.5 text-sm qt-text cursor-pointer">
              <input
                type="radio"
                name={`oneOf-${propKey}`}
                checked={selectedVariant === idx}
                onChange={() => {
                  setSelectedVariant(idx)
                  onChange(propKey, undefined) // Reset value on variant switch
                }}
                className="qt-radio"
              />
              {getVariantLabel(v, idx)}
            </label>
          ))}
        </div>
      )}

      {/* Render the active variant's input */}
      {activeVariant.enum ? (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(propKey, e.target.value)}
          className="qt-select w-full text-sm"
        >
          <option value="">Select...</option>
          {activeVariant.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      ) : activeVariant.type === 'integer' || activeVariant.type === 'number' ? (
        <input
          type="number"
          value={value !== undefined ? String(value) : ''}
          onChange={(e) => {
            const val = e.target.value
            if (val === '') {
              onChange(propKey, undefined)
            } else {
              onChange(propKey, activeVariant.type === 'integer' ? parseInt(val, 10) : parseFloat(val))
            }
          }}
          min={activeVariant.minimum}
          max={activeVariant.maximum}
          step={activeVariant.type === 'integer' ? 1 : 'any'}
          className="qt-input w-full text-sm"
        />
      ) : (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(propKey, e.target.value)}
          className="qt-input w-full text-sm"
        />
      )}
    </div>
  )
}
