/**
 * @jest-environment node
 */
jest.mock('node:dns', () => ({
  promises: {
    lookup: jest.fn(async (host: string) => {
      if (host === 'rebind.example.com') return [{ address: '10.0.0.9', family: 4 }];
      return [{ address: '93.184.216.34', family: 4 }];
    }),
  },
}));

jest.mock('html-to-text', () => ({ convert: (t: string) => t }), { virtual: true });

import { executeCurlRequest } from '@/plugins/dist/qtap-plugin-curl/curl-handler';

const redirectTo = (loc: string) => new Response(null, { status: 302, headers: { location: loc } });

describe('curl plugin: redirects', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('refuses a redirect into a private literal', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (u: string | URL | Request) => {
      calls.push(String(u));
      return redirectTo('http://169.254.169.254/latest/meta-data');
    }) as unknown as typeof fetch;
    const out = await executeCurlRequest({ url: 'https://api.example.com/a' }, { allowedUrlPatterns: 'api.example.com' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/Redirect blocked/);
    expect(calls).toHaveLength(1);
  });

  it('refuses a redirect to a host outside the allowlist', async () => {
    global.fetch = jest.fn(async () => redirectTo('https://other.test/')) as unknown as typeof fetch;
    const out = await executeCurlRequest({ url: 'https://api.example.com/a' }, { allowedUrlPatterns: 'api.example.com' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/allowlist/);
  });

  it('refuses a redirect to a name resolving privately', async () => {
    global.fetch = jest.fn(async () => redirectTo('https://rebind.example.com/')) as unknown as typeof fetch;
    const out = await executeCurlRequest({ url: 'https://api.example.com/a' }, { allowedUrlPatterns: '*.example.com' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/Redirect blocked/);
  });

  it('follows an allowed redirect and reports the final URL', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => (n++ === 0 ? redirectTo('/final') : new Response('done', { status: 200 }))) as unknown as typeof fetch;
    const out = await executeCurlRequest({ url: 'https://api.example.com/a' }, { allowedUrlPatterns: 'api.example.com' });
    expect(out.success).toBe(true);
    expect(out.body).toBe('done');
    expect(out.finalUrl).toBe('https://api.example.com/final');
  });

  it('stops at the hop limit', async () => {
    global.fetch = jest.fn(async () => redirectTo('/again')) as unknown as typeof fetch;
    const out = await executeCurlRequest({ url: 'https://api.example.com/a' }, { allowedUrlPatterns: 'api.example.com' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/Too many redirects/);
  });

  it('does not follow when redirects are disabled', async () => {
    const fn = jest.fn(async () => redirectTo('https://api.example.com/b'));
    global.fetch = fn as unknown as typeof fetch;
    const out = await executeCurlRequest({ url: 'https://api.example.com/a', location: false }, { allowedUrlPatterns: 'api.example.com' });
    expect(out.statusCode).toBe(302);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
