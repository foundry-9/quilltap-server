/**
 * Theme engine — image tokens as the editor sets them: `none`, or one file
 * of the bundle in `url('…')` (Spec E, decision 10).
 *
 * Gradients, data URIs and several layers are left to the text form: `parse`
 * returns null for them. Pure and browser-safe.
 *
 * @module themes/engine/values/image
 */

import { isSafeBundlePath, normaliseBundlePath } from '../css-text';

export type ImageValue = { kind: 'none' } | { kind: 'file'; path: string };

export function parseImage(value: string): ImageValue | null {
  const v = value.trim();
  if (v.toLowerCase() === 'none') return { kind: 'none' };
  const m = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^"'()\s]*))\s*\)$/i.exec(v);
  if (!m) return null;
  const target = m[1] ?? m[2] ?? m[3] ?? '';
  const path = normaliseBundlePath(target);
  return isSafeBundlePath(path) ? { kind: 'file', path } : null;
}

export function formatImage(image: ImageValue): string {
  return image.kind === 'none' ? 'none' : `url('${image.path}')`;
}
