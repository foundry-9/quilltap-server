/**
 * `qtap://` Document URI codec — CLI-local, dependency-free port.
 *
 * Mirrors the server codec at `lib/doc-edit/qtap-uri.ts` (same grammar, same
 * encoding, same tests). Kept as its own small CommonJS module because the
 * server module is not importable from the published CLI package. If the
 * grammar changes, update BOTH and their tests.
 *
 *   qtap://authority/path[#fragment][?query]
 *
 * Authority → { scope, mountPoint }:
 *   self    → document_store, mountPoint 'self'
 *   project → project
 *   general → general
 *   else    → document_store, mountPoint = the decoded authority (name or UUID)
 *
 * @module qtap-uri (CLI)
 */

'use strict';

const QTAP_URI_SCHEME = 'qtap://';
const SELF_VAULT_TOKEN = 'self';

class QtapUriError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'QtapUriError';
    this.code = code;
  }
}

/** True iff the value starts with the qtap:// scheme (case-insensitive). */
function isQtapUri(s) {
  return typeof s === 'string' && s.toLowerCase().startsWith(QTAP_URI_SCHEME);
}

function safeDecode(component) {
  try {
    return decodeURIComponent(component);
  } catch {
    throw new QtapUriError(`Malformed percent-encoding in qtap:// URI segment: "${component}"`, 'MALFORMED');
  }
}

function parseFragment(fragment) {
  if (fragment === '') return {};
  const colonIdx = fragment.lastIndexOf(':');
  if (colonIdx === -1) {
    return { heading: safeDecode(fragment) };
  }
  const headingPart = fragment.slice(0, colonIdx);
  const levelPart = fragment.slice(colonIdx + 1);
  if (!/^[0-9]+$/.test(levelPart)) {
    throw new QtapUriError(`Invalid heading level "${levelPart}" in qtap:// fragment; expected an integer 1–6.`, 'BAD_LEVEL');
  }
  const level = parseInt(levelPart, 10);
  if (level < 1 || level > 6) {
    throw new QtapUriError(`Heading level ${level} out of range in qtap:// fragment; expected 1–6.`, 'BAD_LEVEL');
  }
  return { heading: safeDecode(headingPart), level };
}

function parseQuery(query) {
  if (query === '') return undefined;
  const out = {};
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    if (eq === -1) out[safeDecode(pair)] = '';
    else out[safeDecode(pair.slice(0, eq))] = safeDecode(pair.slice(eq + 1));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Parse a qtap:// URI into { scope, mountPoint?, path, heading?, level?, query? }. */
function parseQtapUri(uri) {
  if (!isQtapUri(uri)) {
    throw new QtapUriError(`Not a qtap:// URI: ${typeof uri === 'string' ? `"${uri}"` : typeof uri}`, 'NOT_A_QTAP_URI');
  }
  let rest = uri.slice(QTAP_URI_SCHEME.length);

  let query;
  const qIdx = rest.indexOf('?');
  if (qIdx !== -1) {
    query = parseQuery(rest.slice(qIdx + 1));
    rest = rest.slice(0, qIdx);
  }

  let heading;
  let level;
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    const frag = parseFragment(rest.slice(hashIdx + 1));
    heading = frag.heading;
    level = frag.level;
    rest = rest.slice(0, hashIdx);
  }

  const slashIdx = rest.indexOf('/');
  const rawAuthority = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const rawPath = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);

  const authority = safeDecode(rawAuthority);
  if (authority === '') {
    throw new QtapUriError('qtap:// URI has an empty authority.', 'EMPTY_AUTHORITY');
  }

  const path = rawPath === '' ? '' : rawPath.split('/').map((seg) => safeDecode(seg)).join('/');

  const lower = authority.toLowerCase();
  const parts = { scope: 'document_store', path };
  if (lower === SELF_VAULT_TOKEN) {
    parts.mountPoint = SELF_VAULT_TOKEN;
  } else if (lower === 'project') {
    parts.scope = 'project';
  } else if (lower === 'general') {
    parts.scope = 'general';
  } else {
    parts.mountPoint = authority;
  }
  if (heading !== undefined) parts.heading = heading;
  if (level !== undefined) parts.level = level;
  if (query !== undefined) parts.query = query;
  return parts;
}

function encodeAuthority(parts) {
  if (parts.scope === 'project') return 'project';
  if (parts.scope === 'general') return 'general';
  const mp = parts.mountPoint || '';
  if (mp.toLowerCase() === SELF_VAULT_TOKEN) return 'self';
  return encodeURIComponent(mp);
}

function encodePath(path) {
  if (!path) return '';
  return path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

/** Inverse of parseQtapUri — always emits canonical encoded form (':' → %3A). */
function formatQtapUri(parts) {
  const authority = encodeAuthority(parts);
  let out = `${QTAP_URI_SCHEME}${authority}/${encodePath(parts.path || '')}`;
  if (parts.heading !== undefined && parts.heading !== '') {
    out += `#${encodeURIComponent(parts.heading)}`;
    if (parts.level !== undefined) out += `:${parts.level}`;
  }
  if (parts.query && Object.keys(parts.query).length > 0) {
    const q = Object.entries(parts.query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    out += `?${q}`;
  }
  return out;
}

/** Build a document-store URI for a store name/UUID and relative path. */
function formatDocStoreUri(authority, path) {
  return formatQtapUri({ scope: 'document_store', mountPoint: authority, path: path || '' });
}

module.exports = {
  QTAP_URI_SCHEME,
  SELF_VAULT_TOKEN,
  QtapUriError,
  isQtapUri,
  parseQtapUri,
  formatQtapUri,
  formatDocStoreUri,
};
