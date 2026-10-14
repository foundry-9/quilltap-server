/**
 * Percent-encode a string as an RFC 8187 ext-value (`charset'lang'value`).
 *
 * `encodeURIComponent` is the right base but too permissive: it leaves
 * `! * ' ( )` unescaped, and those fall outside RFC 8187 `attr-char`. The
 * apostrophe is the worst offender — it is the delimiter in `charset'lang'value`,
 * so an unescaped `'` makes the whole `filename*` ungrammatical and browsers
 * discard it, falling back to the mangled ASCII name. Escape every stray char.
 */
function encodeExtValue(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Content-Disposition header construction shared by every route that serves
 * a download. RFC 5987: plain `filename="…"` for ASCII names, ASCII fallback
 * plus `filename*=UTF-8''…` when the name carries non-ASCII characters.
 */
export function buildContentDisposition(
  filename: string,
  disposition: 'inline' | 'attachment' = 'inline'
): string {
  const hasNonAscii = /[^\x00-\x7F]/.test(filename);
  if (!hasNonAscii) {
    return `${disposition}; filename="${filename}"`;
  }

  const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');
  const encodedFilename = encodeExtValue(filename);
  return `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

/**
 * Whether a request asked for the bytes as a download rather than inline.
 *
 * The three routes that serve image bytes — `/files/[id]`,
 * `/files/proxy/[...key]` and `/mount-points/[id]/blobs/[...path]` — all
 * answer `inline` by default (the Salon embeds them in `<img>`), and all honour
 * `?download=1` by switching to `attachment`. One flag rather than a parallel
 * set of download routes, and one predicate rather than three readings of the
 * query string. `true` is accepted alongside `1` so a hand-typed URL behaves
 * the way a reader expects.
 */
export function wantsAttachment(request?: { url: string } | null): boolean {
  if (!request?.url) return false;
  try {
    const value = new URL(request.url).searchParams.get('download');
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}

/** `'attachment'` when the request asked for a download, else `'inline'`. */
export function dispositionFor(request?: { url: string } | null): 'inline' | 'attachment' {
  return wantsAttachment(request) ? 'attachment' : 'inline';
}
