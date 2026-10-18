/**
 * Inventory SVG glyphs — the sanitiser every write passes an object's inline
 * `svg` through.
 *
 * A glyph is an icon, not a document: it is rendered through an `<img>` data
 * URI (where no script can run anyway), but it is also stored, exported and
 * shown in the Scriptorium, so it is cleaned on write. The sanitiser is an
 * allowlist over a small tokenizer — no DOM on the server:
 *
 *   - the root must be `<svg>`; comments, CDATA, processing instructions and
 *     `<!DOCTYPE>` (and with it any entity declaration) are dropped;
 *   - only drawing elements survive; `script`, `style`, `foreignObject` and
 *     every element not on the list are dropped with their contents;
 *   - `on*` attributes are dropped, as is `href` / `xlink:href` unless it
 *     names a fragment (`#id`), any value carrying `javascript:` or a
 *     `url(` that is not `url(#…)`, and `style` carrying `url(` at all;
 *   - the result may be at most {@link INVENTORY_SVG_MAX_BYTES}.
 *
 * Client-safe: pure.
 *
 * @module lib/inventory/svg
 */

import { INVENTORY_SVG_MAX_BYTES } from '@/lib/schemas/inventory.types';

/** The glyph is not an SVG, or is too large once cleaned (a 400 at the route). */
export class InventorySvgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventorySvgError';
  }
}

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect',
  'title', 'desc', 'defs', 'symbol', 'use', 'lineargradient', 'radialgradient', 'stop',
  'clippath', 'mask', 'pattern', 'text', 'tspan', 'marker',
]);

const HREF_ATTRIBUTES = new Set(['href', 'xlink:href']);

/** True when an attribute and its value are safe to keep. */
function keepAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('on')) return false;
  const compact = value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
  if (compact.includes('javascript:') || compact.includes('data:') || compact.includes('vbscript:')) return false;
  if (HREF_ATTRIBUTES.has(lower)) return value.trim().startsWith('#');
  if (lower === 'style') return !compact.includes('url(') && !compact.includes('expression(') && !compact.includes('@import');
  // Paint and clip references may only point inside the glyph.
  const urls = compact.match(/url\(([^)]*)\)/g) ?? [];
  return urls.every((url) => /^url\(['"]?#/.test(url));
}

const escapeAttribute = (value: string) =>
  value.replace(/&(?![a-z0-9#]+;)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const ATTRIBUTE_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Rebuild a start tag from its allowed attributes. */
function cleanStartTag(name: string, rawAttributes: string, selfClosing: boolean): string {
  const kept: string[] = [];
  for (const match of rawAttributes.matchAll(ATTRIBUTE_RE)) {
    const attr = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(attr)) continue;
    if (!keepAttribute(attr, value)) continue;
    kept.push(`${attr}="${escapeAttribute(value)}"`);
  }
  const attrs = kept.length > 0 ? ` ${kept.join(' ')}` : '';
  return `<${name}${attrs}${selfClosing ? '/>' : '>'}`;
}

/**
 * Clean an operator's SVG. Returns null for an empty input, the cleaned
 * markup otherwise; throws {@link InventorySvgError} when the input is not an
 * `<svg>` or the result is over the cap.
 */
export function sanitizeInventorySvg(input: string | null | undefined): string | null {
  if (input == null) return null;
  const source = input.trim();
  if (source.length === 0) return null;

  const out: string[] = [];
  // Names of open elements; a `null` entry marks an element being dropped.
  const stack: Array<string | null> = [];
  let dropping = 0;
  let sawRoot = false;
  let i = 0;

  const emit = (chunk: string) => {
    if (dropping === 0) out.push(chunk);
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) {
      emit(escapeText(source.slice(i)));
      break;
    }
    if (lt > i) emit(escapeText(source.slice(i, lt)));

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith('<!', lt)) {
      // A DOCTYPE, with any internal subset in brackets.
      let depth = 0;
      let j = lt + 2;
      for (; j < source.length; j++) {
        const ch = source[j];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }

    const gt = findTagEnd(source, lt + 1);
    if (gt < 0) break;
    const rawTag = source.slice(lt + 1, gt);
    i = gt + 1;

    if (rawTag.startsWith('/')) {
      const name = rawTag.slice(1).trim().toLowerCase();
      // Close back to the matching open element, ignoring a stray close.
      const at = lastIndexOfName(stack, name);
      if (at < 0) continue;
      while (stack.length > at) {
        const top = stack.pop();
        if (top === null) dropping--;
        else if (dropping === 0) out.push(`</${top}>`);
      }
      continue;
    }

    const nameMatch = /^([a-zA-Z][-a-zA-Z0-9_:.]*)/.exec(rawTag);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const lower = name.toLowerCase();
    const selfClosing = rawTag.endsWith('/');
    const rawAttributes = rawTag.slice(name.length, selfClosing ? -1 : undefined);

    if (!sawRoot) {
      if (lower !== 'svg') throw new InventorySvgError('An SVG glyph must start with an <svg> element');
      sawRoot = true;
    }

    const allowed = ALLOWED_ELEMENTS.has(lower);
    if (!allowed) {
      if (!selfClosing) {
        stack.push(null);
        dropping++;
      }
      continue;
    }
    emit(cleanStartTag(name, rawAttributes, selfClosing));
    if (!selfClosing) stack.push(name);
  }

  // Close anything left open.
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === null) dropping--;
    else out.push(`</${top}>`);
  }

  if (!sawRoot) throw new InventorySvgError('An SVG glyph must start with an <svg> element');
  const cleaned = out.join('').trim();
  if (new TextEncoder().encode(cleaned).length > INVENTORY_SVG_MAX_BYTES) {
    throw new InventorySvgError(`An SVG glyph may be at most ${INVENTORY_SVG_MAX_BYTES / 1024} KB`);
  }
  return cleaned;
}

/** The index of the `>` closing a tag, skipping quoted attribute values. */
function findTagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let j = from; j < source.length; j++) {
    const ch = source[j];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return j;
    }
  }
  return -1;
}

function lastIndexOfName(stack: ReadonlyArray<string | null>, name: string): number {
  for (let k = stack.length - 1; k >= 0; k--) {
    const entry = stack[k];
    if (entry !== null && entry.toLowerCase() === name) return k;
    // A dropped element closes by its own name too; it was pushed as null,
    // so a close tag for a dropped element matches the nearest null.
    if (entry === null && !ALLOWED_ELEMENTS.has(name)) return k;
  }
  return -1;
}

function escapeText(text: string): string {
  return text.replace(/&(?![a-z0-9#]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The `<img src>` a glyph renders through. */
export function inventorySvgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
