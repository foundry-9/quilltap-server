import { createRoot } from 'react-dom/client'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastOptions {
  duration?: number
  type?: ToastType
}

interface Toast {
  id: string
  message: string
  type: ToastType
  duration: number
}

let toastContainer: HTMLDivElement | null = null
let toastRoot: ReturnType<typeof createRoot> | null = null
let toasts: Toast[] = []

function ensureContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div')
    // Polite live region: screen readers announce each toast as it lands.
    toastContainer.setAttribute('role', 'status')
    toastContainer.setAttribute('aria-live', 'polite')
    toastContainer.setAttribute('data-toast-container', '')
    toastContainer.style.position = 'fixed'
    toastContainer.style.bottom = '20px'
    toastContainer.style.right = '20px'
    // Above every dialog overlay (z-[60]–z-[101]) so a toast raised from inside a
    // modal is visible; below the full-screen startup gates at z-[9999].
    toastContainer.style.zIndex = '1000'
    toastContainer.style.pointerEvents = 'none'
    toastContainer.style.display = 'flex'
    toastContainer.style.flexDirection = 'column'
    toastContainer.style.gap = '10px'
    toastContainer.style.maxWidth = '400px'
    document.body.appendChild(toastContainer)
    toastRoot = createRoot(toastContainer)
  }
}

// Theme status colours: every bundle pairs each fill with a foreground at
// 4.5:1 or better, which the old fixed Tailwind palette did not.
function getToastStyles(type: ToastType) {
  switch (type) {
    case 'success':
      return 'qt-bg-success qt-text-success-foreground qt-border-success'
    case 'error':
      return 'qt-bg-destructive qt-text-destructive-foreground qt-border-destructive'
    case 'warning':
      return 'qt-bg-warning qt-text-warning-foreground qt-border-warning'
    case 'info':
    default:
      return 'qt-bg-info qt-text-info-foreground qt-border-info'
  }
}

function renderToasts() {
  if (!toastRoot) return

  toastRoot.render(
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {toasts.map((toast) => {
        const styles = getToastStyles(toast.type)
        // Errors interrupt; everything else waits its turn in the polite region.
        return (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : undefined}
            className={`app-toast ${styles} border px-4 py-3 rounded-lg shadow-lg pointer-events-auto`}
            style={{
              animation: 'slideInUp 0.3s ease-out',
            }}
          >
            {toast.message}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Shows a toast notification with the given message.
 * Toast notifications are temporary, non-blocking messages that appear in the bottom-right corner.
 *
 * @param message - The message to display
 * @param options - Configuration options (duration in ms, type of toast)
 */
function showToast(message: string, options: ToastOptions = {}): string {
  ensureContainer()

  const {
    duration = 3000,
    type = 'info',
  } = options

  const id = `toast-${Date.now()}-${Math.random()}`

  const toast: Toast = {
    id,
    message,
    type,
    duration,
  }

  toasts.push(toast)
  renderToasts()

  // Auto-remove after duration
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id)
    renderToasts()
  }, duration)

  return id
}

/**
 * Convenience function for success toasts
 */
export function showSuccessToast(message: string, duration?: number): string {
  return showToast(message, { type: 'success', duration })
}

/**
 * Convenience function for error toasts
 */
export function showErrorToast(message: string, duration?: number): string {
  return showToast(message, { type: 'error', duration })
}

/**
 * Convenience function for warning toasts
 */
export function showWarningToast(message: string, duration?: number): string {
  return showToast(message, { type: 'warning', duration })
}

/**
 * Convenience function for info toasts
 */
export function showInfoToast(message: string, duration?: number): string {
  return showToast(message, { type: 'info', duration })
}

