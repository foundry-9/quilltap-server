'use client'

/**
 * CanDrawDiagramsToggle
 *
 * The "this character draws diagrams" card shared by the character detail and
 * edit views' Details tabs, with the style choice (hand-drawn / clean)
 * directly beneath it. Presentational: the owning view persists both values
 * (vault `properties.json`) and passes back `saving`.
 *
 * The style stays visible — and keeps its value — while the ability is off;
 * it is only disabled, so switching the ability off and on again loses
 * nothing.
 */

import type { DiagramStyle } from '@/lib/markdown/diagrams'

export interface CanDrawDiagramsToggleProps {
  checked: boolean
  style: DiagramStyle
  saving: boolean
  disabled: boolean
  onChange: (enabled: boolean) => void | Promise<void>
  onStyleChange: (style: DiagramStyle) => void | Promise<void>
}

const STYLE_OPTIONS: ReadonlyArray<{ value: DiagramStyle; label: string; hint: string }> = [
  { value: 'handDrawn', label: 'Hand-drawn', hint: 'sketched in ink, a touch wobbly' },
  { value: 'clean', label: 'Clean', hint: 'ruled lines, as the engine drew them' },
]

export function CanDrawDiagramsToggle({
  checked,
  style,
  saving,
  disabled,
  onChange,
  onStyleChange,
}: CanDrawDiagramsToggleProps) {
  const styleDisabled = !checked || saving || disabled
  return (
    <div className="qt-card" data-testid="can-draw-diagrams">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={saving || disabled}
          className="mt-1 accent-[var(--primary)]"
          aria-describedby="can-draw-diagrams-hint"
        />
        <span className="flex-1 min-w-0">
          <span className="qt-text-label block">Draws diagrams</span>
          <span id="can-draw-diagrams-hint" className="qt-text-small qt-text-secondary block mt-0.5">
            This character may sketch flowcharts, family trees, maps and the
            like right into the conversation. The toggle only grants the
            pen — to have them reach for it often, say so in their prompt.
          </span>
        </span>
        {saving && (
          <span className="h-4 w-4 mt-1 animate-spin rounded-full qt-spinner shrink-0" />
        )}
      </label>
      <fieldset className="mt-3 ml-7" disabled={styleDisabled} aria-disabled={styleDisabled}>
        <legend className={`qt-text-small mb-1 ${styleDisabled ? 'qt-text-muted' : 'qt-text-secondary'}`}>
          Drawing style
        </legend>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {STYLE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-center gap-2 text-sm ${styleDisabled ? 'cursor-not-allowed qt-text-muted' : 'cursor-pointer'}`}
            >
              <input
                type="radio"
                name="diagram-style"
                className="qt-radio"
                value={option.value}
                checked={style === option.value}
                onChange={() => onStyleChange(option.value)}
                disabled={styleDisabled}
              />
              <span>
                {option.label}
                <span className="qt-text-xs qt-text-secondary"> — {option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
