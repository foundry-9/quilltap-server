'use strict';

/**
 * The one way a `quilltap memories` verb asks the running server to do what
 * the CLI cannot: anything that calls a model, computes an embedding or
 * writes. The CLI's own database access is read-only; `maintain`,
 * `validate --repair` and `keystone` resolve what they can locally and send
 * the rest to `/api/v1/memories?action=<action>` (or, for a hand edit, the
 * memory's own PUT).
 *
 * The port comes from `resolveServerPort` (lock-helpers): an explicit
 * `--port`, else the port recorded in the `--instance` / `--data-dir`
 * instance's lock, else 3000.
 */

const { resolveServerPort } = require('./lock-helpers');

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** Resolve the server port for a memories verb, printing the lock note (if any) to stderr. */
function resolveMemoriesServerPort(flags, { quiet = false } = {}) {
  const target = resolveServerPort({
    port: flags.port,
    instance: flags.instance || undefined,
    dataDir: flags.dataDir || undefined,
  });
  if (target.note && !quiet) process.stderr.write(`${DIM}${target.note}${RESET}\n`);
  return target;
}

/**
 * Send `body` to a memories API path on the running server and return the
 * parsed payload. Throws an Error with a readable message on a connection
 * failure or a non-2xx response.
 */
async function requestMemoriesApi(flags, method, path, body, opts = {}) {
  const { why, announce, fetchImpl = fetch, action } = opts;
  const target = resolveMemoriesServerPort(flags);
  const url = `http://localhost:${target.port}${path}`;
  if (announce) announce(url);

  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Could not reach the Quilltap server at http://localhost:${target.port}: ${err.message}\n` +
      (why ? `${why}\n` : '') +
      target.hint
    );
  }

  let payload = null;
  try {
    const text = await res.text();
    payload = text ? JSON.parse(text) : null;
  } catch { /* leave payload null */ }

  if (!res.ok) {
    let msg = (payload && payload.error) || `HTTP ${res.status}`;
    if (payload && Array.isArray(payload.details) && payload.details.length > 0) {
      msg += ': ' + payload.details
        .map((d) => `${Array.isArray(d.path) && d.path.length ? d.path.join('.') + ' ' : ''}${d.message || ''}`.trim())
        .join('; ');
    }
    if (action && res.status === 400 && /unknown action|invalid action/i.test(msg)) {
      msg += ` (is the server older than this CLI? '${action}' needs a matching Quilltap server)`;
    }
    throw new Error(msg);
  }
  return payload;
}

/**
 * POST `body` to `/api/v1/memories?action=<action>` and return the parsed
 * payload. Throws an Error with a readable message on a connection failure
 * or a non-2xx response.
 *
 * @param {object} flags            parsed memories flags (port / instance / dataDir)
 * @param {string} action           the `?action=` name
 * @param {object} body             JSON request body
 * @param {object} [opts]
 * @param {string} [opts.why]       one line on why the server is needed
 * @param {(msg: string) => void} [opts.announce] called with the URL before the request
 * @param {typeof fetch} [opts.fetchImpl] for tests
 */
async function postMemoriesAction(flags, action, body, opts = {}) {
  return requestMemoriesApi(flags, 'POST', `/api/v1/memories?action=${encodeURIComponent(action)}`, body, { ...opts, action });
}

/**
 * PUT a hand edit to `/api/v1/memories/<id>` (the edit chokepoint) and return
 * the parsed payload (`{ memory }`). Same options and errors as
 * {@link postMemoriesAction}.
 */
async function putMemory(flags, id, body, opts = {}) {
  return requestMemoriesApi(flags, 'PUT', `/api/v1/memories/${encodeURIComponent(id)}`, body, opts);
}

module.exports = { postMemoriesAction, putMemory, resolveMemoriesServerPort };
