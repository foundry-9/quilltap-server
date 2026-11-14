/**
 * @jest-environment node
 */
jest.mock('node:dns', () => ({
  promises: { lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]) },
}));

import { downloadRemoteImage as nano } from '@/plugins/dist/qtap-plugin-nanogpt/remote-image';
import { downloadRemoteImage as zai } from '@/plugins/dist/qtap-plugin-z-ai/remote-image';

describe.each([['nanogpt', nano], ['z-ai', zai]])('%s remote image download', (_n, download) => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('requires https', async () => {
    await expect(download('http://example.com/a.png', 'T')).rejects.toThrow(/https/);
  });

  it('refuses private and mapped literals', async () => {
    for (const u of ['https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://[::ffff:7f00:1]/a.png', 'https://169.254.169.254/a.png']) {
      await expect(download(u, 'T')).rejects.toThrow(/non-public/);
    }
  });

  it('refuses a redirect to a private address', async () => {
    global.fetch = jest.fn(async () => new Response(null, { status: 302, headers: { location: 'https://10.0.0.1/x' } })) as unknown as typeof fetch;
    await expect(download('https://cdn.example.com/a.png', 'T')).rejects.toThrow(/non-public/);
  });

  it('caps the streamed size', async () => {
    const big = new Uint8Array(26 * 1024 * 1024);
    global.fetch = jest.fn(async () => new Response(big, { status: 200, headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
    await expect(download('https://cdn.example.com/a.png', 'T')).rejects.toThrow(/size limit/);
  });

  it('returns base64 and the declared type', async () => {
    global.fetch = jest.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp; charset=x' } })) as unknown as typeof fetch;
    const r = await download('https://cdn.example.com/a.webp', 'T');
    expect(r).toEqual({ data: 'AQID', mimeType: 'image/webp' });
  });
});
