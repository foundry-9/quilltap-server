'use client'

/**
 * Where each Auto-Configure value came from, listed under the profile form's
 * test buttons so a looked-up figure can be told from a guessed one.
 */

import type { AutoConfigureField, AutoConfigureResult } from '@/lib/services/auto-configure.service'

const FIELD_LABELS: Record<AutoConfigureField, string> = {
  maxContext: 'Context window',
  maxTokens: 'Max output',
  temperature: 'Temperature',
  topP: 'Top P',
  isDangerousCompatible: 'Uncensored',
  modelClass: 'Model class',
  supportsTools: 'Native tool calling',
  supportsImages: 'Image input',
}

const FIELD_ORDER: AutoConfigureField[] = [
  'maxContext',
  'maxTokens',
  'supportsTools',
  'supportsImages',
  'modelClass',
  'temperature',
  'topP',
  'isDangerousCompatible',
]

function formatValue(field: AutoConfigureField, result: AutoConfigureResult): string {
  const value = result[field]
  if (value === null) return 'unknown'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}

interface AutoConfigureSourcesProps {
  result: AutoConfigureResult
}

export function AutoConfigureSources({ result }: AutoConfigureSourcesProps) {
  return (
    <div className="qt-settings-sources">
      <dl className="qt-settings-sources-list">
        {FIELD_ORDER.map((field) => (
          <div key={field} className="qt-settings-sources-row">
            <dt className="qt-settings-sources-term">{FIELD_LABELS[field]}</dt>
            <dd>
              {formatValue(field, result)}{' '}
              <span className="qt-text-secondary">— {result.fieldSources[field]?.label ?? 'unknown'}</span>
            </dd>
          </div>
        ))}
      </dl>
      {result.pseudoToolMode === 'simple-json' && (
        <p className="qt-text-secondary qt-settings-sources-note">
          This route does not offer native tool calling, so the tool format has been set to Simple JSON.
        </p>
      )}
      {result.catalogError && (
        <p className="qt-text-secondary qt-settings-sources-note">
          The provider&rsquo;s own catalogue could not be consulted ({result.catalogError}); other sources were used.
        </p>
      )}
    </div>
  )
}
