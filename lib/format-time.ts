/**
 * Format a timestamp as a human-readable string.
 * For messages from today, shows "X hours ago" or "X minutes ago"
 * For older messages, shows the date
 */
export function formatMessageTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()

  // Get the start of today
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  // Check if message is from today
  if (messageDate.getTime() === today.getTime()) {
    const diffMs = now.getTime() - date.getTime()
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

    if (diffMinutes < 1) {
      return 'just now'
    }
    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`
    }
  }

  // For older messages, show date
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

export interface FormatDateOptions {
  /** Include year in output. Default: true. */
  includeYear?: boolean
  /** Month style: 'short' (Jan) or 'long' (January). Default: 'short'. */
  monthStyle?: 'short' | 'long'
}

/**
 * Format as date only (no time). Falls back to the raw string if parsing
 * fails, and returns '' for null/undefined.
 */
export function formatDate(
  dateString: string | null | undefined,
  opts: FormatDateOptions = {},
): string {
  if (!dateString) return ''
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: opts.includeYear === false ? undefined : 'numeric',
      month: opts.monthStyle ?? 'short',
      day: 'numeric',
    })
  } catch {
    return String(dateString)
  }
}

/**
 * Format as date plus time (2-digit hour/minute). Falls back to the raw
 * string if parsing fails, and returns '' for null/undefined.
 */
export function formatDateTime(
  dateString: string | null | undefined,
  opts: FormatDateOptions = {},
): string {
  if (!dateString) return ''
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: opts.includeYear === false ? undefined : 'numeric',
      month: opts.monthStyle ?? 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(dateString)
  }
}

/**
 * Format as a relative timestamp ("Just now", "12m ago", "3h ago") for the
 * first day, then a short date+time. Falls back to the raw string if
 * parsing fails, and returns '' for null/undefined.
 */
export function formatRelativeDate(
  dateString: string | null | undefined,
): string {
  if (!dateString) return ''
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(dateString)
  }
}

/**
 * Chat-list date: today→time, yesterday→'Yesterday', <7d→weekday, else→date
 * (with year only when different from current). When useRelative is false,
 * returns the plain locale date string.
 */
export function formatChatListDate(
  dateString: string,
  useRelative: boolean,
): string {
  const date = new Date(dateString)
  if (!useRelative) return date.toLocaleDateString()

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'long' })
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}
