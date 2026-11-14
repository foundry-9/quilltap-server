/**
 * @jest-environment node
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

jest.mock('node:dns', () => ({
  promises: { lookup: jest.fn() },
}));

import { promises as dnsPromises } from 'node:dns';
import { safeFetch, SafeFetchError } from '@/lib/net/safe-fetch';

const lookupMock = dnsPromises.lookup as unknown as jest.Mock;

let server: http.Server;
let base: string;
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  lookupMock.mockReset();
  handler = (_req, res) => { res.end('ok'); };
});

const code = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return (e as SafeFetchError).code; }
  return 'NO_ERROR';
};

describe('safeFetch destination checks', () => {
  it('refuses non-http schemes', async () => {
    expect(await code(safeFetch('file:///etc/passwd', { maxBytes: 100 }))).toBe('BAD_SCHEME');
    expect(await code(safeFetch('ftp://example.com/x', { maxBytes: 100 }))).toBe('BAD_SCHEME');
  });

  it('refuses private literals, bracketed and mapped IPv6 included', async () => {
    for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://169.254.169.254/', 'http://0x7f.1/']) {
      expect(await code(safeFetch(u, { maxBytes: 100 }))).toBe('BLOCKED_ADDRESS');
    }
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('refuses localhost names without resolving them', async () => {
    expect(await code(safeFetch('http://localhost:3000/', { maxBytes: 100 }))).toBe('BLOCKED_ADDRESS');
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves to any private address', async () => {
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }]);
    expect(await code(safeFetch('http://rebind.test/', { maxBytes: 100 }))).toBe('BLOCKED_ADDRESS');
  });

  it('refuses embedded credentials', async () => {
    expect(await code(safeFetch('http://u:p@example.com/', { maxBytes: 100 }))).toBe('BAD_URL');
  });
});

describe('safeFetch transfer behaviour (allowPrivate, local server)', () => {
  it('returns the body', async () => {
    const r = await safeFetch(`${base}/a`, { maxBytes: 100, allowPrivate: true });
    expect(r.status).toBe(200);
    expect(r.text()).toBe('ok');
  });

  it('pins the connection to the validated address', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const port = new URL(base).port;
    const r = await safeFetch(`http://pinned.test:${port}/`, { maxBytes: 100, allowPrivate: true });
    expect(r.text()).toBe('ok');
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it('aborts when the stream exceeds maxBytes without Content-Length', async () => {
    handler = (_req, res) => {
      res.write(Buffer.alloc(600));
      setTimeout(() => res.end(Buffer.alloc(600)), 10);
    };
    expect(await code(safeFetch(`${base}/big`, { maxBytes: 1000, allowPrivate: true }))).toBe('TOO_LARGE');
  });

  it('refuses early on a declared oversize length', async () => {
    handler = (_req, res) => { res.setHeader('content-length', '5000'); res.end(Buffer.alloc(5000)); };
    expect(await code(safeFetch(`${base}/big`, { maxBytes: 1000, allowPrivate: true }))).toBe('TOO_LARGE');
  });

  it('follows redirects and re-validates each hop', async () => {
    handler = (req, res) => {
      if (req.url === '/start') { res.statusCode = 302; res.setHeader('location', '/end'); res.end(); }
      else res.end('landed');
    };
    const r = await safeFetch(`${base}/start`, { maxBytes: 100, allowPrivate: true });
    expect(r.text()).toBe('landed');
    expect(r.redirected).toBe(true);
  });

  it('stops after too many redirects', async () => {
    handler = (_req, res) => { res.statusCode = 302; res.setHeader('location', '/loop'); res.end(); };
    expect(await code(safeFetch(`${base}/loop`, { maxBytes: 100, allowPrivate: true, maxRedirects: 3 }))).toBe('TOO_MANY_REDIRECTS');
  });

  it('times out', async () => {
    handler = () => { /* never answers */ };
    expect(await code(safeFetch(`${base}/slow`, { maxBytes: 100, allowPrivate: true, timeoutMs: 100 }))).toBe('TIMEOUT');
  });
});
