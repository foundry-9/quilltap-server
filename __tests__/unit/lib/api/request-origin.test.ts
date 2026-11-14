/**
 * The request-origin gate shared by proxy.ts and the WebSocket upgrade.
 */

import {
  allowedHostsFromEnv,
  checkRequestOrigin,
  hostnameOf,
  isAllowedHost,
} from '@/lib/api/request-origin';

const api = { requireSameOrigin: true, allowedHosts: [] as string[] };
const page = { requireSameOrigin: false, allowedHosts: [] as string[] };

describe('hostnameOf', () => {
  it('strips ports and keeps IPv6 brackets', () => {
    expect(hostnameOf('LocalHost:3000')).toBe('localhost');
    expect(hostnameOf('[::1]:3000')).toBe('[::1]');
    expect(hostnameOf('192.168.1.5')).toBe('192.168.1.5');
  });
});

describe('isAllowedHost', () => {
  it('answers to loopback names and IP literals', () => {
    for (const host of ['localhost:3000', 'app.localhost', '127.0.0.1:3000', '[::1]:3000', '10.0.0.7:3000']) {
      expect(isAllowedHost(host, [])).toBe(true);
    }
  });

  it('refuses an unknown host name', () => {
    expect(isAllowedHost('attacker.example:3000', [])).toBe(false);
    expect(isAllowedHost('localhost.attacker.example', [])).toBe(false);
  });

  it('answers to configured names and wildcard subdomains', () => {
    expect(isAllowedHost('quill.example.com', ['quill.example.com'])).toBe(true);
    expect(isAllowedHost('a.example.com', ['*.example.com'])).toBe(true);
    expect(isAllowedHost('example.com', ['*.example.com'])).toBe(false);
    expect(isAllowedHost('badexample.com', ['*.example.com'])).toBe(false);
  });
});

describe('allowedHostsFromEnv', () => {
  it('reads BASE_URL and QUILLTAP_ALLOWED_HOSTS', () => {
    expect(
      allowedHostsFromEnv({
        BASE_URL: 'https://Quill.Example.com/app',
        QUILLTAP_ALLOWED_HOSTS: ' nas.local , *.lan:3000 ,',
      }),
    ).toEqual(['quill.example.com', 'nas.local', '*.lan']);
  });

  it('ignores an unparseable BASE_URL', () => {
    expect(allowedHostsFromEnv({ BASE_URL: 'not a url' })).toEqual([]);
  });
});

describe('checkRequestOrigin', () => {
  it('allows a same-origin browser request', () => {
    expect(
      checkRequestOrigin(
        { host: 'localhost:3000', origin: 'http://localhost:3000', secFetchSite: 'same-origin' },
        api,
      ),
    ).toEqual({ ok: true });
  });

  it('allows a non-browser request with no Origin or Sec-Fetch-Site', () => {
    expect(checkRequestOrigin({ host: '127.0.0.1:3000', origin: null, secFetchSite: null }, api).ok).toBe(true);
  });

  it('refuses a cross-site API request by Origin', () => {
    const verdict = checkRequestOrigin(
      { host: 'localhost:3000', origin: 'https://evil.example', secFetchSite: null },
      api,
    );
    expect(verdict.ok).toBe(false);
  });

  it('refuses a cross-site API request by Sec-Fetch-Site even without Origin', () => {
    for (const site of ['cross-site', 'same-site']) {
      expect(checkRequestOrigin({ host: 'localhost:3000', origin: null, secFetchSite: site }, api).ok).toBe(false);
    }
  });

  it('refuses another port on the same machine', () => {
    const verdict = checkRequestOrigin(
      { host: 'localhost:3000', origin: 'http://localhost:5173', secFetchSite: null },
      api,
    );
    expect(verdict.ok).toBe(false);
  });

  it('refuses the opaque null Origin', () => {
    expect(checkRequestOrigin({ host: 'localhost:3000', origin: 'null', secFetchSite: null }, api).ok).toBe(false);
  });

  it('refuses any request addressed to an unknown host, pages included', () => {
    const input = { host: 'rebound.example:3000', origin: null, secFetchSite: 'none' };
    expect(checkRequestOrigin(input, api).ok).toBe(false);
    expect(checkRequestOrigin(input, page).ok).toBe(false);
  });

  it('refuses a request with no Host', () => {
    expect(checkRequestOrigin({ host: '', origin: null, secFetchSite: null }, page).ok).toBe(false);
  });

  it('lets a page navigation arrive from another site', () => {
    expect(
      checkRequestOrigin({ host: 'localhost:3000', origin: null, secFetchSite: 'cross-site' }, page).ok,
    ).toBe(true);
  });

  it('accepts a configured public origin behind a proxy that rewrites Host', () => {
    expect(
      checkRequestOrigin(
        { host: '127.0.0.1:3000', origin: 'https://quill.example.com', secFetchSite: 'same-origin' },
        { requireSameOrigin: true, allowedHosts: ['quill.example.com'] },
      ).ok,
    ).toBe(true);
  });
});
