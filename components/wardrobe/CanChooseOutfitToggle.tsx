'use client'

/**
 * CanChooseOutfitToggle
 *
 * The "let this character choose their opening outfit" card shared by the
 * character detail and edit views' Wardrobe tabs. Presentational: the owning
 * view persists the flag (vault `properties.json`).
 */

export interface CanChooseOutfitToggleProps {
  checked: boolean
  disabled: boolean
  onChange: (enabled: boolean) => void | Promise<void>
}

export function CanChooseOutfitToggle({ checked, disabled, onChange }: CanChooseOutfitToggleProps) {
  return (
    <div className="border qt-border-default rounded-lg p-4 qt-bg-card">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="mt-1 accent-[var(--primary)]"
        />
        <span className="flex-1 min-w-0">
          <span className="qt-text-label block">Let this character choose their opening outfit</span>
          <span className="qt-text-small qt-text-secondary block mt-0.5">
            When enabled, a new chat with this character defaults its
            Starting Outfit to “Let character choose” instead of their
            default wardrobe. You can still overrule it per chat.
          </span>
        </span>
      </label>
    </div>
  )
}
