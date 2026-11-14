/**
 * Request body parsing
 *
 * A body that cannot be parsed is the caller's mistake (400), not a crash
 * (500). `req.json()` throws a bare `SyntaxError` and `req.formData()` a
 * `TypeError`, neither of which says where it came from — a `SyntaxError`
 * from some unrelated `JSON.parse` deep inside a handler would look the same.
 * So the route middleware tags the request's own parsers
 * (`guardRequestBodyParsers`): a failure there becomes a
 * `RequestBodyParseError`, which the middleware answers with a 400 (#221).
 *
 * Handlers that need to tell an empty body from a malformed one use
 * `readJsonBody` (#220).
 */

import { logger } from '@/lib/logger';

const bodyLogger = logger.child({ module: 'api-request-body' });

export class RequestBodyParseError extends Error {
  constructor(
    public readonly kind: 'json' | 'form-data',
    cause?: unknown,
  ) {
    super(
      kind === 'json'
        ? 'Request body could not be parsed as JSON'
        : 'Request body could not be parsed as multipart form data',
    );
    this.name = 'RequestBodyParseError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

const GUARDED = Symbol.for('quilltap.requestBodyGuarded');

/**
 * Wrap `request.json()` and `request.formData()` so a parse failure throws a
 * `RequestBodyParseError`. Idempotent; never throws (a request object that
 * refuses the override is left alone and keeps the old 500 behaviour).
 */
export function guardRequestBodyParsers(request: Request): void {
  const target = request as Request & { [GUARDED]?: boolean };
  if (target[GUARDED]) return;
  try {
    const json = typeof request.json === 'function' ? request.json.bind(request) : null;
    const formData = typeof request.formData === 'function' ? request.formData.bind(request) : null;
    if (json) {
      Object.defineProperty(target, 'json', {
        configurable: true,
        writable: true,
        value: () =>
          json().catch((error: unknown) => {
            throw new RequestBodyParseError('json', error);
          }),
      });
    }
    if (formData) {
      Object.defineProperty(target, 'formData', {
        configurable: true,
        writable: true,
        value: () =>
          formData().catch((error: unknown) => {
            throw new RequestBodyParseError('form-data', error);
          }),
      });
    }
    Object.defineProperty(target, GUARDED, { value: true });
  } catch (error) {
    bodyLogger.debug('Could not guard request body parsers', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Read a JSON body where an absent body is allowed. An empty (or
 * whitespace-only) body is `emptyValue`; anything else that is not JSON
 * throws `RequestBodyParseError` — never silently `{}`.
 */
export async function readJsonBody<T = unknown>(request: Request, emptyValue: T): Promise<T | unknown> {
  let text: string;
  try {
    text = await request.text();
  } catch (error) {
    throw new RequestBodyParseError('json', error);
  }
  if (text.trim() === '') {
    bodyLogger.debug('Empty JSON body; using default');
    return emptyValue;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    bodyLogger.debug('Malformed JSON body', { length: text.length });
    throw new RequestBodyParseError('json', error);
  }
}
