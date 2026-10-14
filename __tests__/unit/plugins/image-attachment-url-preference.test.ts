/**
 * Bug 174 — a vault image reached Z.AI and NanoGPT as the host's own
 * server-relative path instead of its bytes.
 *
 * `loadMountFileAsAttachment` used to set `url` to
 * `/api/v1/mount-points/<id>/blobs/<path>` beside the base64 `data`, and both
 * plugins sent `url` in preference to `data`. Z.AI answered
 * "messages[0].content[0].file must contain at least one of file_id, file_url,
 * or file_data" and every vision profile failed the turn. The host no longer
 * sets that `url` (see chat-files-v2-mount-document.test.ts); these cases pin
 * the plugins' half: bytes win, and only an absolute http(s) URL is ever
 * forwarded on its own.
 */

import { ZAIProvider } from '@/plugins/dist/qtap-plugin-z-ai/provider';
import { NanoGPTProvider } from '@/plugins/dist/qtap-plugin-nanogpt/provider';

jest.mock('openai', () => {
  const create = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create } },
      models: { list: jest.fn() },
    })),
  };
});

import OpenAI from 'openai';

const FAKE_COMPLETION = {
  choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const VAULT_PATH =
  '/api/v1/mount-points/701e03fd-9bed-4b75-b126-f25e5498eaba/blobs/photos/2026-10-01T20-19-26.593Z-finally-laura.webp';

const WEBP = {
  id: 'attachment-1',
  filename: 'finally-laura.webp',
  mimeType: 'image/webp',
  size: 2048,
  data: 'UklGRg==',
};

let create: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  create = jest.fn().mockResolvedValue(FAKE_COMPLETION);
  (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    chat: { completions: { create } },
    models: { list: jest.fn() },
  }));
});

const PROVIDERS = [
  ['Z.AI', () => new ZAIProvider(), 'glm-5.3-flash'],
  ['NanoGPT', () => new NanoGPTProvider(), 'some/vision-model'],
] as const;

async function send(
  makeProvider: () => { sendMessage: (p: never, k: string) => Promise<unknown> },
  model: string,
  attachment: Record<string, unknown>,
) {
  const response = (await makeProvider().sendMessage(
    { model, messages: [{ role: 'user', content: 'What is this?', attachments: [attachment] }] } as never,
    'test-key',
  )) as { attachmentResults?: { sent: string[]; failed: { id: string; error: string }[] } };
  const body = (create.mock.calls[0]?.[0] ?? {}) as { messages: { content: unknown }[] };
  const parts = body.messages[body.messages.length - 1].content as { type: string; image_url?: { url: string } }[];
  const imageUrls = Array.isArray(parts) ? parts.filter(p => p.type === 'image_url').map(p => p.image_url!.url) : [];
  return { imageUrls, results: response.attachmentResults };
}

describe.each(PROVIDERS)('bug 174 — %s sends the bytes, not a host path', (_name, makeProvider, model) => {
  it('sends a data: URI when an attachment carries both data and a relative url', async () => {
    const { imageUrls, results } = await send(makeProvider, model, { ...WEBP, url: VAULT_PATH });

    expect(imageUrls).toEqual([`data:image/webp;base64,${WEBP.data}`]);
    expect(results?.sent).toEqual([WEBP.id]);
  });

  it('prefers the bytes even over an absolute url', async () => {
    const { imageUrls } = await send(makeProvider, model, { ...WEBP, url: 'https://example.com/a.webp' });

    expect(imageUrls).toEqual([`data:image/webp;base64,${WEBP.data}`]);
  });

  it('forwards an absolute http(s) url when there are no bytes', async () => {
    const { imageUrls, results } = await send(makeProvider, model, {
      ...WEBP,
      data: undefined,
      url: 'https://example.com/a.webp',
    });

    expect(imageUrls).toEqual(['https://example.com/a.webp']);
    expect(results?.sent).toEqual([WEBP.id]);
  });

  it('refuses a relative url with no bytes rather than sending it', async () => {
    const { imageUrls, results } = await send(makeProvider, model, { ...WEBP, data: undefined, url: VAULT_PATH });

    expect(imageUrls).toEqual([]);
    expect(results?.sent).toEqual([]);
    expect(results?.failed[0].error).toMatch(/missing data or URL/i);
  });
});
