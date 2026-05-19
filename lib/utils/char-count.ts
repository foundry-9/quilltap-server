/**
 * Pick the qt-* text colour class for a character-count indicator based on
 * how close `current` is to `max`. Shared by the editor components that
 * render "N / M characters" hints under text fields.
 */
export function charCountClass(current: number, max: number): string {
  if (current > max) return 'qt-text-destructive'
  if (current > max * 0.9) return 'qt-text-warning'
  return 'qt-text-secondary'
}
