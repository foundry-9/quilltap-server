'use client'

/**
 * "What about the components?" — the all-or-nothing choice offered when an
 * outfit is moved or copied, whether to another wardrobe
 * (`WardrobeTransferDialog`) or to a folder (`WardrobeFolderPickerDialog`).
 *
 * A move offers move / copy / leave; a copy offers copy / leave (it cannot
 * move the pieces its original still wears). `defaultComponentMode` is the
 * starting choice: an outfit that arrives without its pieces is rarely what
 * anyone meant.
 *
 * @module components/wardrobe/WardrobeComponentModeFieldset
 */

/** What travels with a composite outfit: its components, or nothing. */
export type ComponentMode = 'move' | 'copy' | 'none'

/** The starting choice for a move or a copy. */
export function defaultComponentMode(mode: 'move' | 'copy'): ComponentMode {
  return mode === 'move' ? 'move' : 'copy'
}

interface WardrobeComponentModeFieldsetProps {
  mode: 'move' | 'copy'
  value: ComponentMode
  onChange: (value: ComponentMode) => void
  /** The legend — what is being carried, e.g. "This outfit bundles 3 components". */
  legend: string
  /** Where the components go, for the footnote: another wardrobe, or a folder. */
  destination: 'wardrobe' | 'folder'
  /** Distinguishes the radio group when two dialogs are mounted at once. */
  name: string
  disabled?: boolean
}

export function WardrobeComponentModeFieldset({
  mode,
  value,
  onChange,
  legend,
  destination,
  name,
  disabled = false,
}: WardrobeComponentModeFieldsetProps) {
  const options =
    mode === 'move'
      ? ([
          { value: 'move', label: 'Move the components along with it' },
          { value: 'copy', label: 'Copy the components (originals stay behind)' },
          { value: 'none', label: 'Leave the components behind' },
        ] as const)
      : ([
          { value: 'copy', label: 'Copy the components along with it' },
          { value: 'none', label: 'Copy the outfit alone' },
        ] as const)

  return (
    <fieldset>
      <legend className="text-sm qt-text-secondary mb-1">{legend}</legend>
      <div className="space-y-1">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name={name}
              className="qt-radio"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              disabled={disabled}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <p className="qt-text-xs qt-text-secondary mt-1">
        {destination === 'wardrobe'
          ? 'All or nothing — the choice covers every component, nested pieces included. Only components living in the same wardrobe travel; pieces from a shared tier stay put. The transferred outfit is rewired to point at whichever components arrive with it.'
          : 'All or nothing — the choice covers every component, nested pieces included. Only components filed in this wardrobe travel; pieces borrowed from a shared tier stay put. Copied components take a "(copy)" title, and the outfit is rewired to point at them.'}
      </p>
    </fieldset>
  )
}
