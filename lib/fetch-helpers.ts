/**
 * Safely parse a JSON response, handling cases where the server returns HTML error pages
 */
export async function safeJsonParse<T = unknown>(response: Response): Promise<T> {
  const text = await response.text()

  try {
    return JSON.parse(text) as T
  } catch {
    // If parsing fails, the server likely returned HTML (error page)
    if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
      throw new Error(`Server error (${response.status}): Unexpected HTML response`)
    }
    throw new Error(`Failed to parse response: ${text.substring(0, 100)}`)
  }
}

/**
 * The message to show for an error body. A validation failure's `error` is
 * only the category ("Validation error"); its `message` says what was wrong.
 */
export function readErrorMessage(data: unknown): string | undefined {
  const body = data as { error?: string; message?: string } | null | undefined
  if (body?.error === 'Validation error' && body.message) return body.message
  return body?.error
}

/**
 * Fetch JSON with safe error handling
 * Properly handles cases where the server returns HTML error pages
 */
export async function fetchJson<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const response = await fetch(url, options)
    const data = await safeJsonParse<T>(response)

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: readErrorMessage(data) || `Request failed with status ${response.status}`,
      }
    }

    return { ok: true, status: response.status, data }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Network error',
    }
  }
}
