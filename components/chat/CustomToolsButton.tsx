'use client'

/**
 * CustomToolsButton — the wand in the composer gutter (and, in `palette`
 * variant, on the tool palette) that opens Pascal's table.
 *
 * Nothing but a button. The dialog itself lives in the Salon's `ChatModals`,
 * mounted unconditionally so it keeps its memory while closed, and shared with
 * the composer's `/` commands — two launch points, one instance.
 */

import { Icon } from '@/components/ui/icon'

interface CustomToolsButtonProps {
  /** Opens Pascal's table */
  onClick: () => void
  /** Whether the button is disabled */
  disabled?: boolean
  /** Button variant: 'palette' (default) for tool palette, 'gutter' for composer gutter */
  variant?: 'palette' | 'gutter'
}

export function CustomToolsButton({
  onClick,
  disabled = false,
  variant = 'palette',
}: Readonly<CustomToolsButtonProps>) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      className={variant === 'gutter' ? 'qt-composer-gutter-button' : 'qt-tool-palette-button'}
      title="Custom tools"
      aria-haspopup="dialog"
      aria-label="Custom tools"
    >
      <Icon name="wand" className={variant === 'gutter' ? 'w-5 h-5' : 'w-4 h-4'} />
      {variant === 'palette' && <span>Tools</span>}
    </button>
  )
}

export default CustomToolsButton
