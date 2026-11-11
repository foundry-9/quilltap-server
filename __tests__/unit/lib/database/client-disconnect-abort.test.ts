/**
 * @jest-environment node
 *
 * A browser that reloads or closes mid-request makes Node destroy the incoming
 * request with `Error('aborted')`, code `ECONNRESET`. Escaping its request's
 * promise chain, it reached the process-wide uncaughtException handler, which
 * closed SQLite and exited — the dev server died on an ordinary page reload
 * during the dogfood run of a fresh instance. The handler now recognises it.
 */

import { isClientDisconnectAbort } from '@/lib/database/backends/sqlite/client';

function errnoError(message: string, code?: string): Error {
  const err = new Error(message) as NodeJS.ErrnoException;
  if (code) err.code = code;
  return err;
}

describe('isClientDisconnectAbort', () => {
  it('recognises a request the client abandoned', () => {
    expect(isClientDisconnectAbort(errnoError('aborted', 'ECONNRESET'))).toBe(true);
  });

  it('leaves other ECONNRESETs to the normal handling', () => {
    expect(isClientDisconnectAbort(errnoError('read ECONNRESET', 'ECONNRESET'))).toBe(false);
  });

  it('leaves an "aborted" error without the reset code alone', () => {
    expect(isClientDisconnectAbort(errnoError('aborted'))).toBe(false);
    expect(isClientDisconnectAbort(errnoError('aborted', 'ABORT_ERR'))).toBe(false);
  });

  it('ignores non-errors', () => {
    expect(isClientDisconnectAbort('aborted')).toBe(false);
    expect(isClientDisconnectAbort(null)).toBe(false);
  });
});
