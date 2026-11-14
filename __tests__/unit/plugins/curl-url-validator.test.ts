/**
 * @jest-environment node
 */
import {
  isPrivateHost,
  parseUrlPatterns,
  urlMatchesPatterns,
  validateUrl,
  validateUrlResolved,
} from '@/plugins/dist/qtap-plugin-curl/url-validator';

const allow = (p: string) => parseUrlPatterns(p);

describe('curl plugin: private host detection', () => {
  it.each([
    'localhost', 'app.localhost', '127.0.0.1', '[::1]', '::1', '[fe80::1]', '[fc00::1]', '[fd00::1]',
    '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '10.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::]',
  ])('blocks %s', (h) => {
    expect(isPrivateHost(h)).toBe(true);
  });

  it('blocks URLs with bracketed private literals', () => {
    const patterns = allow('*');
    for (const u of ['http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fe80::1]/', 'http://0x7f.1/']) {
      expect(validateUrl(u, patterns).valid).toBe(false);
    }
  });

  it('allows public hosts', () => {
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
  });
});

describe('curl plugin: allowlist matching', () => {
  it('does not let a wildcard host match across the URL', () => {
    const p = allow('*.example.com');
    expect(urlMatchesPatterns('https://api.example.com/x', p)).toBe(true);
    expect(urlMatchesPatterns('https://attacker.net/x.example.com', p)).toBe(false);
    expect(urlMatchesPatterns('https://attacker.net/?q=.example.com', p)).toBe(false);
    expect(urlMatchesPatterns('https://a.example.com.attacker.net/', p)).toBe(false);
  });

  it('matches exact hosts on any path, default port only', () => {
    const p = allow('api.github.com');
    expect(urlMatchesPatterns('https://api.github.com/repos/x', p)).toBe(true);
    expect(urlMatchesPatterns('http://api.github.com/', p)).toBe(true);
    expect(urlMatchesPatterns('https://api.github.com:8443/', p)).toBe(false);
    expect(urlMatchesPatterns('https://evil.api.github.com.x.io/', p)).toBe(false);
  });

  it('honours scheme, port and path in a pattern', () => {
    expect(urlMatchesPatterns('http://x.com/', allow('https://x.com'))).toBe(false);
    expect(urlMatchesPatterns('https://x.com:8443/', allow('x.com:8443'))).toBe(true);
    const p = allow('https://x.com/v1/*');
    expect(urlMatchesPatterns('https://x.com/v1/a', p)).toBe(true);
    expect(urlMatchesPatterns('https://x.com/v1/a/b', p)).toBe(true);
    expect(urlMatchesPatterns('https://x.com/v2/a', p)).toBe(false);
    expect(urlMatchesPatterns('https://x.com/v10/a', allow('https://x.com/v1'))).toBe(false);
  });

  it('allows nothing when there are no patterns', () => {
    expect(urlMatchesPatterns('https://example.com/', [])).toBe(false);
  });
});

describe('curl plugin: resolved validation', () => {
  const patterns = allow('*.example.com\nexample.com');

  it('refuses a name that resolves to a private address', async () => {
    const r = await validateUrlResolved('https://a.example.com/', patterns, async () => [{ address: '10.0.0.5' }]);
    expect(r.valid).toBe(false);
  });

  it('refuses when any result is private', async () => {
    const r = await validateUrlResolved('https://a.example.com/', patterns, async () => [
      { address: '93.184.216.34' }, { address: '::ffff:7f00:1' },
    ]);
    expect(r.valid).toBe(false);
  });

  it('accepts public results and reports lookup failure', async () => {
    expect((await validateUrlResolved('https://a.example.com/', patterns, async () => [{ address: '93.184.216.34' }])).valid).toBe(true);
    const failed = await validateUrlResolved('https://a.example.com/', patterns, async () => { throw new Error('ENOTFOUND'); });
    expect(failed.valid).toBe(false);
  });
});
