/**
 * Response headers for stored, user-supplied bytes — the one place a route
 * decides how a browser may treat a file it did not author.
 *
 * Rules:
 *   - Only an allowlist of passive types may be served `inline`: raster
 *     images (PNG, JPEG, GIF, WebP, AVIF), PDF and plain text. Everything else
 *     is `attachment`, whatever the caller asked for.
 *   - Types a browser would execute or render as a document with script
 *     (HTML, XHTML, XML, JavaScript, …) are additionally served as
 *     `application/octet-stream`, so the stored label cannot reintroduce them.
 *     SVG is the exception: it keeps `image/svg+xml`, which `<img>` and CSS
 *     `url()` require to decode it (an image context never runs its script),
 *     and is always `attachment`, so a direct navigation downloads it.
 *   - Every response carries `X-Content-Type-Options: nosniff` and a
 *     restrictive `Content-Security-Policy`: `sandbox; default-src 'none'`
 *     plus image and inline-style allowances. PDF omits `sandbox`, because
 *     browsers' built-in PDF viewers do not load inside a sandboxed document.
 *
 * `Content-Disposition` only governs navigation: `<img>`, CSS `url()`,
 * `@font-face`, `<video>` and `fetch()` ignore it, so an `attachment` file
 * still works everywhere the app embeds or fetches it.
 *
 * Note: a `Content-Security-Policy` set by `next.config.js` `headers()` for
 * the same path is applied first and Next.js does not replace it with the
 * route's value. The disposition and type rules above do not depend on CSP.
 *
 * @module api/serve-stored-bytes
 */

import { NextResponse } from 'next/server';
import { buildContentDisposition } from '@/lib/api/content-disposition';
import { logger as rootLogger } from '@/lib/logger';

/** Debug logging, guarded: route tests often replace the logger with partial mocks. */
function logDebug(message: string, context: Record<string, unknown>): void {
  rootLogger?.debug?.(message, { module: 'api:serve-stored-bytes', ...context });
}

/** Base MIME types that may be rendered inline. */
export const INLINE_SAFE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'text/plain',
]);

/** Base MIME types never sent under their own label. */
export const ACTIVE_MIME_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'application/xslt+xml',
  'application/rdf+xml',
  'application/mathml+xml',
  'text/xsl',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'application/ecmascript',
  'text/jscript',
  'application/wasm',
  'multipart/x-mixed-replace',
]);

export const OCTET_STREAM = 'application/octet-stream';

/** CSP sent with stored bytes. */
export const STORED_BYTES_CSP =
  "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'";

/** CSP sent with an inline PDF (no `sandbox`; see the module comment). */
export const STORED_PDF_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'";

/** Lower-cased MIME type without parameters; empty string for a missing value. */
export function baseMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

export function isInlineSafeMimeType(mimeType: string | null | undefined): boolean {
  return INLINE_SAFE_MIME_TYPES.has(baseMimeType(mimeType));
}

/**
 * Whether a type is active content. Any `+xml` suffix counts, as does any
 * type naming JavaScript or HTML.
 */
export function isActiveMimeType(mimeType: string | null | undefined): boolean {
  const base = baseMimeType(mimeType);
  if (ACTIVE_MIME_TYPES.has(base)) return true;
  if (base.endsWith('+xml')) return true;
  return /javascript|ecmascript|html/.test(base);
}

/** Active type kept under its own label so image contexts can still decode it. */
export const SVG_MIME_TYPE = 'image/svg+xml';

/** The `Content-Type` actually sent for a stored type. */
export function servedContentType(mimeType: string | null | undefined): string {
  const base = baseMimeType(mimeType);
  if (base === SVG_MIME_TYPE) return SVG_MIME_TYPE;
  if (!base || isActiveMimeType(base)) return OCTET_STREAM;
  // Keep parameters (e.g. charset) only on the stored, non-active value.
  return (mimeType ?? '').trim() || OCTET_STREAM;
}

export interface StoredBytesHeaderOptions {
  /** The stored MIME type (caller-chosen, untrusted). */
  mimeType: string | null | undefined;
  /** Filename for `Content-Disposition`. */
  filename: string;
  /** What the request asked for (`dispositionFor(request)`); default `inline`. */
  requested?: 'inline' | 'attachment';
  /** Byte length, sent as `Content-Length` when given. */
  size?: number;
  /** `Cache-Control` value; omitted when not given. */
  cacheControl?: string;
  /** Additional headers (e.g. a content hash). May not override the rules above. */
  extra?: Record<string, string>;
}

/** The disposition actually sent: `inline` only for an allowlisted type that asked for it. */
export function servedDisposition(
  mimeType: string | null | undefined,
  requested: 'inline' | 'attachment' = 'inline'
): 'inline' | 'attachment' {
  return requested === 'inline' && isInlineSafeMimeType(mimeType) ? 'inline' : 'attachment';
}

/** Headers this module owns; `extra` cannot set them. */
const RULE_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'content-disposition',
  'x-content-type-options',
  'x-frame-options',
  'content-security-policy',
  'content-length',
  'cache-control',
]);

/** Build the headers for stored bytes. */
export function storedBytesHeaders(options: StoredBytesHeaderOptions): Record<string, string> {
  const disposition = servedDisposition(options.mimeType, options.requested);
  const contentType = servedContentType(options.mimeType);
  const isPdf = baseMimeType(options.mimeType) === 'application/pdf';

  if (disposition !== (options.requested ?? 'inline') || contentType !== (options.mimeType ?? '')) {
    logDebug('Stored bytes served with adjusted headers', {
      storedMimeType: options.mimeType ?? null,
      contentType,
      requested: options.requested ?? 'inline',
      disposition,
    });
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.extra ?? {})) {
    if (!RULE_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  headers['Content-Type'] = contentType;
  headers['Content-Disposition'] = buildContentDisposition(options.filename || 'file', disposition);
  headers['X-Content-Type-Options'] = 'nosniff';
  headers['X-Frame-Options'] = 'SAMEORIGIN';
  headers['Content-Security-Policy'] = isPdf && disposition === 'inline' ? STORED_PDF_CSP : STORED_BYTES_CSP;
  if (options.size !== undefined) headers['Content-Length'] = String(options.size);
  if (options.cacheControl) headers['Cache-Control'] = options.cacheControl;
  return headers;
}

/** A `NextResponse` carrying stored bytes under {@link storedBytesHeaders}. */
export function serveStoredBytes(
  body: Uint8Array,
  options: StoredBytesHeaderOptions & { status?: number }
): NextResponse {
  const { status, ...headerOptions } = options;
  return new NextResponse(body as unknown as BodyInit, {
    status: status ?? 200,
    headers: storedBytesHeaders({ size: body.byteLength, ...headerOptions }),
  });
}
