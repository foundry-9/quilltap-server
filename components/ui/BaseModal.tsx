'use client'

import { createContext, useCallback, useContext, useId, useRef, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceTabVisible } from '@/components/workspace/workspace-tab-context'

/**
 * Size variants for the modal
 */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'wide' | 'full'

/**
 * Props for the BaseModal component
 */
export interface BaseModalProps {
  /** Whether the modal is currently open */
  isOpen: boolean
  /** Callback when the modal should close */
  onClose: () => void
  /**
   * The modal title displayed in the header. A `headerless` modal still needs
   * one: draw it with `<ModalTitle>` inside the body so the dialog keeps its
   * accessible name.
   */
  title?: ReactNode
  /** A line under the title (`qt-dialog-description`) */
  subtitle?: ReactNode
  /** Extra controls in the header, right-aligned beside the close button */
  headerActions?: ReactNode
  /** The main content of the modal */
  children: ReactNode
  /** Optional footer content (typically FormActions) */
  footer?: ReactNode
  /** Maximum width of the modal - defaults to 'lg' */
  maxWidth?: ModalSize
  /**
   * `alertdialog` for destructive confirmations; `dialog` (the default) for
   * everything else. An open `alertdialog` owns Escape and outside clicks
   * even when it has not taken focus.
   */
  role?: 'dialog' | 'alertdialog'
  /**
   * While true, Escape, an outside click and the header close button do
   * nothing — a backup is being written, a request is in flight.
   */
  busy?: boolean
  /**
   * The modal draws its own header. The shell renders no header strip; put a
   * `<ModalTitle>` somewhere in the children so `aria-labelledby` resolves.
   */
  headerless?: boolean
  /** Additional classes to apply to the modal container */
  className?: string
  /**
   * Classes for the body wrapper, replacing the default
   * `qt-dialog-body flex-1 overflow-y-auto` — for dialogs whose body is a
   * split pane or a full-bleed list.
   */
  bodyClassName?: string
  /** Classes for the footer, replacing the default `qt-dialog-footer` */
  footerClassName?: string
  /**
   * Additional classes for the full-screen overlay — e.g. a raised `z-[…]`
   * when the modal opens over a viewer already above the dialog layer.
   */
  overlayClassName?: string
  /** Whether to show the close button in the header - defaults to false */
  showCloseButton?: boolean
  /**
   * Whether a click on the backdrop (anywhere outside the dialog) closes it -
   * defaults to true. A form the user is typing into opts out.
   */
  closeOnClickOutside?: boolean
  /** Whether pressing Escape should close the modal - defaults to true */
  closeOnEscape?: boolean
  /** Forwarded to the dialog element, for tests and theme hooks */
  'data-testid'?: string
}

const maxWidthClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
  wide: 'qt-dialog-wide',
  full: 'max-w-full',
}

/** Marks an open BaseModal's dialog element, so the stack can be read from the DOM. */
const MODAL_ATTR = 'data-qt-modal'

const ModalTitleContext = createContext<string | null>(null)

/**
 * The id the enclosing BaseModal's `aria-labelledby` points at. For a
 * `headerless` modal that labels itself some other way than `<ModalTitle>`.
 */
export function useModalTitleId(): string | null {
  return useContext(ModalTitleContext)
}

/**
 * The accessible title of a `headerless` BaseModal, drawn wherever the dialog's
 * own header puts it.
 */
export function ModalTitle({ children, className = 'qt-dialog-title' }: { children: ReactNode; className?: string }) {
  const titleId = useModalTitleId()
  return <h2 id={titleId ?? undefined} className={className}>{children}</h2>
}

/** The dialog (or alert) an element belongs to, if any. */
function dialogOf(node: EventTarget | null): Element | null {
  return node instanceof Element ? node.closest('[role="dialog"],[role="alertdialog"]') : null
}

/**
 * Whether another BaseModal was opened over `modal`. Every modal paints at the
 * same z-index, so the one later in the document is the one on top — the stack
 * is the DOM order of the open modals, and nothing else needs to keep it.
 */
function aModalIsAbove(modal: HTMLElement | null): boolean {
  if (!modal || typeof document === 'undefined') return false
  const open = document.querySelectorAll(`[${MODAL_ATTR}]`)
  const last = open[open.length - 1]
  return last !== undefined && last !== modal && !modal.contains(last)
}

/**
 * Whether an event belongs to another dialog layered over `modal`: a BaseModal
 * opened above it; or its target is inside another dialog, or focus is (a
 * topmost dialog holds focus, so this also covers a click on that dialog's own
 * backdrop); or a confirmation (`alertdialog`, always on top) is open, whether
 * or not it took focus.
 */
function anotherDialogOwns(modal: HTMLElement | null, target: EventTarget | null): boolean {
  if (typeof document === 'undefined') return false
  if (aModalIsAbove(modal)) return true
  // Another BaseModal is in the stack, and none is above this one, so it is
  // beneath: focus or a click still sitting in it (the opener of a child that
  // has not yet taken focus) does not make it the owner.
  const others = [dialogOf(target), dialogOf(document.activeElement), ...document.querySelectorAll('[role="alertdialog"]')]
  return others.some(
    (dialog) => dialog !== null && dialog !== modal && !modal?.contains(dialog) && !dialog.hasAttribute(MODAL_ATTR),
  )
}

/**
 * The one dialog shell. Every modal in the app is a BaseModal (or a named
 * variant such as `WizardModal`); a lint gate (`scripts/check-modal-shell.mjs`)
 * holds it. The shell owns:
 * - the portal to `document.body` — `.qt-workspace` is `isolation: isolate`,
 *   so an un-portaled overlay paints under the sticky toolbar;
 * - focus: in on open, Tab trapped, back to the opener on close;
 * - the stack: only the topmost dialog answers Escape or an outside click, so
 *   a child dialog (Summon from Lore over Add Character) is never "outside"
 *   its parent;
 * - the backdrop, the `busy` guard and the one z-index (`qt-dialog-overlay`).
 *
 * @example
 * <BaseModal
 *   isOpen={isOpen}
 *   onClose={handleClose}
 *   title="Edit Profile"
 *   footer={
 *     <FormActions
 *       onCancel={handleClose}
 *       onSubmit={handleSubmit}
 *       isLoading={loading}
 *     />
 *   }
 * >
 *   <div className="space-y-4">
 *     <input type="text" ... />
 *   </div>
 * </BaseModal>
 */
export function BaseModal({
  isOpen,
  onClose,
  title,
  subtitle,
  headerActions,
  children,
  footer,
  maxWidth = 'lg',
  role = 'dialog',
  busy = false,
  headerless = false,
  className = '',
  bodyClassName = 'qt-dialog-body flex-1 overflow-y-auto',
  footerClassName = 'qt-dialog-footer',
  overlayClassName = '',
  showCloseButton = false,
  closeOnClickOutside = true,
  closeOnEscape = true,
  'data-testid': testId,
}: BaseModalProps) {
  // A dialog portals to the body, so one opened in a kept-alive workspace tab
  // would float over whichever tab the user moved to. While its tab is hidden
  // it stands down (Escape included); the caller's state is untouched, so it
  // comes back with the tab. Outside the workspace this is always true.
  const tabVisible = useWorkspaceTabVisible()
  const shown = isOpen && tabVisible
  const modalRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const subtitleId = useId()
  const handleFocusKeyDown = useDialogFocus(modalRef, shown)

  // Only the dialog on top answers an outside click or Escape, and a busy one
  // answers neither.
  const closeIfOnTop = useCallback(
    (event?: Event) => {
      if (busy) return
      if (anotherDialogOwns(modalRef.current, event?.target ?? null)) return
      onClose()
    },
    [busy, onClose],
  )
  useClickOutside(modalRef, closeIfOnTop, {
    enabled: shown && closeOnClickOutside,
    onEscape: closeOnEscape ? closeIfOnTop : undefined,
  })
  // Escape still needs a listener when outside clicks are off.
  useClickOutside(modalRef, noop, {
    enabled: shown && !closeOnClickOutside && closeOnEscape,
    onEscape: closeIfOnTop,
  })

  if (!shown || typeof document === 'undefined') return null

  const closeButton = showCloseButton ? (
    <button
      type="button"
      onClick={() => { if (!busy) onClose() }}
      disabled={busy}
      className="qt-text-secondary hover:qt-text transition-colors disabled:opacity-50"
      aria-label="Close"
    >
      <Icon name="close" className="w-5 h-5" />
    </button>
  ) : null

  // p-4 keeps a margin round the dialog on narrow screens.
  return createPortal(
    <div className={`qt-dialog-overlay p-4 ${overlayClassName}`}>
      <div
        ref={modalRef}
        className={`qt-dialog ${maxWidthClasses[maxWidth]} max-h-[90vh] flex flex-col ${className}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle && !headerless ? subtitleId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={handleFocusKeyDown}
        data-testid={testId}
        {...{ [MODAL_ATTR]: '' }}
      >
        <ModalTitleContext.Provider value={titleId}>
          {!headerless && (
            <div className="qt-dialog-header flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id={titleId} className="qt-dialog-title">{title}</h2>
                {subtitle && <p id={subtitleId} className="qt-dialog-description">{subtitle}</p>}
              </div>
              {(headerActions || closeButton) && (
                <div className="flex items-center gap-2 shrink-0">
                  {headerActions}
                  {closeButton}
                </div>
              )}
            </div>
          )}

          <div className={bodyClassName}>{children}</div>

          {footer && <div className={footerClassName}>{footer}</div>}
        </ModalTitleContext.Provider>
      </div>
    </div>,
    document.body
  )
}

function noop() {}

export default BaseModal
