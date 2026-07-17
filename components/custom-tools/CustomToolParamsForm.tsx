'use client'

/**
 * CustomToolParamsForm — the parameter form generated from a custom tool's
 * `parameters` declarations.
 *
 * Extracted from {@link CustomToolsDropdown} so the composer popup and Pascal's
 * Workbench proving bench render the very same form from the very same
 * declarations — a third copy would drift. The markup here must stay
 * behaviour-identical to what the dropdown always rendered.
 *
 * Values are held loosely (text inputs yield strings) and coerced back to the
 * declared types on use, via {@link coerceParamValues}.
 */

/** A single declared parameter of a custom-tool definition. */
export interface CustomToolParameterSpec {
  type: 'number' | 'integer' | 'string' | 'boolean'
  default: number | string | boolean
  description?: string
  min?: number
  max?: number
}

/** Form values are held loosely (text inputs yield strings) and coerced on use. */
export type ParameterFormValues = Record<string, string | boolean>

/** Seed a form from the declared defaults. */
export function initialParamValues(
  parameters: Record<string, CustomToolParameterSpec>,
): ParameterFormValues {
  const values: ParameterFormValues = {}
  for (const [name, param] of Object.entries(parameters)) {
    values[name] = param.type === 'boolean' ? Boolean(param.default) : String(param.default)
  }
  return values
}

/**
 * Coerce the form's loose values back to the declared types. Blank or
 * unparseable numbers fall back to the declared default rather than sending
 * NaN — the server validates properly; this only keeps the payload well-typed.
 */
export function coerceParamValues(
  parameters: Record<string, CustomToolParameterSpec>,
  values: ParameterFormValues,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const [name, param] of Object.entries(parameters)) {
    const raw = values[name]
    if (param.type === 'boolean') {
      out[name] = Boolean(raw)
      continue
    }
    if (param.type === 'string') {
      out[name] = typeof raw === 'string' ? raw : String(param.default)
      continue
    }
    const parsed = param.type === 'integer'
      ? parseInt(String(raw), 10)
      : parseFloat(String(raw))
    out[name] = Number.isFinite(parsed) ? parsed : Number(param.default)
  }
  return out
}

interface CustomToolParamsFormProps {
  parameters: Record<string, CustomToolParameterSpec>
  values: ParameterFormValues
  onChange: (param: string, value: string | boolean) => void
  disabled?: boolean
  /** Unique prefix for input ids, so two forms on one page never collide. */
  idPrefix: string
}

export function CustomToolParamsForm({
  parameters,
  values,
  onChange,
  disabled = false,
  idPrefix,
}: Readonly<CustomToolParamsFormProps>) {
  return (
    <>
      {Object.entries(parameters).map(([name, param]) => {
        const inputId = `${idPrefix}-${name}`
        if (param.type === 'boolean') {
          return (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input
                id={inputId}
                type="checkbox"
                checked={Boolean(values[name])}
                onChange={(e) => onChange(name, e.target.checked)}
                disabled={disabled}
              />
              <span title={param.description}>{name}</span>
            </label>
          )
        }
        return (
          <div key={name} className="flex items-center justify-between gap-2">
            <label htmlFor={inputId} className="text-sm" title={param.description}>
              {name}
            </label>
            <input
              id={inputId}
              type={param.type === 'string' ? 'text' : 'number'}
              value={String(values[name] ?? '')}
              onChange={(e) => onChange(name, e.target.value)}
              min={param.type === 'string' ? undefined : param.min}
              max={param.type === 'string' ? undefined : param.max}
              disabled={disabled}
              className={param.type === 'string' ? 'qt-input w-40' : 'qt-input w-20'}
            />
          </div>
        )
      })}
    </>
  )
}

export default CustomToolParamsForm
