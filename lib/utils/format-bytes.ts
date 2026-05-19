/**
 * Format a byte count as a human-readable string ("123 B", "1.5 KB", etc.).
 *
 * Uses the 1024-based scale (the de facto convention in UI throughout the
 * project) with single-letter unit labels. Sub-KB values show as whole
 * bytes; everything else rounds to one decimal. Scales up to TB; values
 * larger than that still render in TB rather than spilling off the unit
 * table.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return ''
  if (bytes === 0) return '0 B'
  if (bytes < 0) return `-${formatBytes(-bytes)}`
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1)
  if (i === 0) return `${bytes} B`
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}
