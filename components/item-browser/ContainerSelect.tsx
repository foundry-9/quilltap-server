'use client'

/**
 * The container `<select>` of a tiered browser (the wardrobe's, the
 * Inventory's) and of its Move / Copy to another tier dialogs: Characters,
 * General, Projects, Groups, each an `<optgroup>`, every option's value the
 * container's encoded key (`scope:id`). Containers named in `exclude` (an
 * item's own home, in a transfer) are left out; an empty group is dropped.
 *
 * @module components/item-browser/ContainerSelect
 */

import {
  GENERAL_CONTAINER,
  encodeWardrobeContainer,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import type { ContainerCatalogue } from '@/lib/hooks/use-container-catalogue'

export interface ContainerSelectProps {
  id: string
  /** The encoded key of the chosen container, or `''`. */
  value: string
  onChange: (key: string) => void
  catalogue: Pick<ContainerCatalogue, 'characters' | 'projects' | 'groups'>
  /** The General option's name, e.g. `Quilltap General`. */
  generalName: string
  /** Shown (disabled) while nothing is chosen. */
  placeholder: string
  /** Encoded keys to leave out. */
  exclude?: readonly string[]
  className?: string
  disabled?: boolean
}

export function ContainerSelect({
  id,
  value,
  onChange,
  catalogue,
  generalName,
  placeholder,
  exclude = [],
  className = 'qt-select w-full',
  disabled,
}: ContainerSelectProps) {
  const options = (scope: WardrobeContainer['scope'], entries: ReadonlyArray<{ id: string; name: string }>) =>
    entries
      .map((e) => ({ key: encodeWardrobeContainer({ scope, id: e.id }), name: e.name }))
      .filter((o) => !exclude.includes(o.key))
  const groups: Array<{ label: string; options: Array<{ key: string; name: string }> }> = [
    { label: 'Characters', options: options('character', catalogue.characters) },
    {
      label: 'General',
      options: [{ key: encodeWardrobeContainer(GENERAL_CONTAINER), name: generalName }].filter((o) => !exclude.includes(o.key)),
    },
    { label: 'Projects', options: options('project', catalogue.projects) },
    { label: 'Groups', options: options('group', catalogue.groups) },
  ].filter((g) => g.options.length > 0)

  return (
    <select id={id} className={className} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!value && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
