'use client'

/**
 * The footer of a "Move / Copy to another tier" dialog — the wardrobe's and
 * the Inventory's: Cancel, and the submit button that reads *Moving…* /
 * *Copying…* while the transfer is out. The bodies (and the request each kind
 * sends) stay the kinds' own; the transfer services differ on purpose.
 *
 * @module components/item-browser/ItemTransferFooter
 */

export interface ItemTransferFooterProps {
  mode: 'move' | 'copy'
  working: boolean
  /** The submit button's label at rest; defaults to `Move` / `Copy`. */
  submitLabel?: string
  /** Disable the submit button (nothing chosen yet). */
  submitDisabled?: boolean
  onCancel: () => void
  onSubmit: () => void
}

export function ItemTransferFooter({ mode, working, submitLabel, submitDisabled = false, onCancel, onSubmit }: ItemTransferFooterProps) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className="qt-button-secondary qt-button-sm" onClick={onCancel} disabled={working}>
        Cancel
      </button>
      <button type="button" className="qt-button-primary qt-button-sm" onClick={onSubmit} disabled={working || submitDisabled}>
        {working ? (mode === 'move' ? 'Moving…' : 'Copying…') : (submitLabel ?? (mode === 'move' ? 'Move' : 'Copy'))}
      </button>
    </div>
  )
}
