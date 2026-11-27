/**
 * One-shot startup notices: read what the server recorded during startup
 * (plugin upgrades, migration warnings), show each as a toast in turn, then
 * tell the server they have been shown so a refresh does not repeat them.
 *
 * The read happens once per page load, after a short delay so the page can
 * render first. When the server is not ready yet, or has nothing to report,
 * nothing is shown and nothing is marked.
 *
 * @module components/startup/startup-notices
 */

/** Delay between toast notifications in milliseconds */
const TOAST_DELAY_MS = 3000

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export interface StartupNoticesConfig<TResponse> {
  /** Wait this long after mount before reading */
  initialDelayMs: number
  /** GET endpoint that reports the notices */
  url: string
  /** POST endpoint that marks them shown */
  markNotifiedUrl: string
  /** Console context for a failed read or an unexpected error */
  label: string
  /**
   * Turn the response into the toasts to show, in order — or null when there
   * is nothing to show (not ready, no notices, or an error the reader logged).
   */
  toNotices: (data: TResponse) => Array<() => void> | null
}

/**
 * Build the notifier for one kind of startup notice. Each notifier guards
 * itself against running twice at once (a remount during the delay).
 */
export function createStartupNotifier<TResponse>(config: StartupNoticesConfig<TResponse>): () => Promise<void> {
  let inProgress = false

  return async function notify(): Promise<void> {
    if (inProgress) return
    inProgress = true

    try {
      await delay(config.initialDelayMs)

      const response = await fetch(config.url)
      if (!response.ok) {
        console.error(`Failed to fetch ${config.label}`, { status: response.status })
        return
      }

      const notices = config.toNotices((await response.json()) as TResponse)
      if (!notices || notices.length === 0) return

      for (let i = 0; i < notices.length; i++) {
        notices[i]()
        if (i < notices.length - 1) await delay(TOAST_DELAY_MS)
      }

      await fetch(config.markNotifiedUrl, { method: 'POST' })
    } catch (error) {
      console.error(`Error checking ${config.label}`, {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      inProgress = false
    }
  }
}
