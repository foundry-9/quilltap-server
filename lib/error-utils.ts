/**
 * Client-safe Error Utilities
 *
 * These utilities can be safely imported in both client and server components.
 * For server-only error handling (with logging, NextResponse), use lib/errors.ts
 */

/**
 * Extract error message from unknown error type
 *
 * Safely extracts a string message from any error type.
 * Use this instead of the common pattern:
 *   const errorMessage = error instanceof Error ? error.message : String(error)
 *
 * @param error - The caught error (unknown type)
 * @param fallback - Optional fallback message if error has no message (default: 'Unknown error')
 * @returns The error message string
 */
export function getErrorMessage(error: unknown, fallback: string = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (error !== null && error !== undefined) {
    const stringified = String(error)
    if (stringified !== '[object Object]') {
      return stringified
    }
  }
  return fallback
}
