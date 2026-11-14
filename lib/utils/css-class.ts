/**
 * CSS class names carried by roleplay templates. Letters, digits, underscore,
 * hyphen and spaces (for several classes) are the whole alphabet; everything
 * else is dropped on read and refused on write.
 *
 * @module utils/css-class
 */

export const CLASS_NAME_REGEX = /^[A-Za-z0-9_\- ]+$/;
export const CLASS_NAME_MAX = 200;

/** Strip disallowed characters and cap the length. Never throws. */
export function sanitizeClassName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^A-Za-z0-9_\- ]/g, '').slice(0, CLASS_NAME_MAX).trim();
}
