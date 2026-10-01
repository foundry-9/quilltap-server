# Bug 174 — vault images reach Z.AI and NanoGPT as an internal relative URL

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-01)** |
| **Found** | 2026-10-01, live on `Friday`, chat `ef567933-12cb-4f0c-bb26-1a3d22a6a12d`, while reviewing recent GLM errors. Reproduced the same day against `api.z.ai` with V4test's key |
| **Fixed** | 2026-10-01, v4.10-dev (`qtap-plugin-z-ai` 1.1.32, `qtap-plugin-nanogpt` 1.2.9) |
| **Severity** | Medium. Any vision profile on an affected plugin fails outright once the chat context carries an image from a document store (a character-vault photo, a project-store image, a Lantern background). A 400 is not a fallback trigger, so the turn just stops, and switching to another vision profile on the same provider fails the same way |
| **Who it bites** | Z.AI (`qtap-plugin-z-ai` 1.1.31) and NanoGPT (`qtap-plugin-nanogpt`) vision profiles. Their `supportsImageUpload = 0` profiles are spared because the describe-fallback replaces the image with text first. Plugins that ignore `url` (OpenAI, Anthropic and others) are unaffected |
| **Provenance** | Original to v4. The host side arrived with `45dcf97dc` (2026-05-15, "hard-linkable files via content/link split"), which gave mount-file attachments a `url` of `/api/v1/mount-points/<id>/blobs/<path>` alongside their base64 `data` |
| **Defect site** | `lib/chat-files-v2.ts:663–673` (`loadMountFileAsAttachment` sets `url` to a server-relative API path; the native-text branch at `:589–598` does the same). Consumed by `plugins/dist/qtap-plugin-z-ai/provider.ts:149–153` and `plugins/dist/qtap-plugin-nanogpt/provider.ts:102–105` (`attachmentToImageUrl`), which prefer `url` over `data` |
| **Fix site** | `lib/chat-files-v2.ts` (`loadMountFileAsAttachment` sets `filepath` only) and `attachmentToImageUrl` in `plugins/dist/qtap-plugin-z-ai/provider.ts` and `plugins/dist/qtap-plugin-nanogpt/provider.ts` (prefer `data`; forward only absolute `http(s)` URLs) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-01).** Both halves were fixed. `loadMountFileAsAttachment` no longer
sets `url`, in either the blob or the native-text branch; the server path stays in `filepath`. The
Z.AI and NanoGPT plugins send `data` whenever an attachment has bytes and forward `url` only when it
is an absolute `http(s)` address, so a relative path is refused rather than sent. Pinned by
`__tests__/unit/plugins/image-attachment-url-preference.test.ts` (both plugins: bytes beat a
relative or absolute `url`, an absolute `url` alone is forwarded, a relative `url` alone is refused)
and two cases in `__tests__/unit/lib/chat-files-v2-mount-document.test.ts` (no `url` on a blob or
document attachment). Failed calls are still not written to `llm_logs`; that is left as a follow-up.

## Symptom

On `Friday`, 2026-10-01 (UTC), Friday's turn failed three times in a row:

```
400 messages[0].content[0].file must contain at least one of file_id, file_url, or file_data
```

| Time | Profile | Model | Result |
|---|---|---|---|
| 20:22:08 | Z.AI GLM 5.3 Flash | `glm-5.3-flash` | OK (no vault image in context yet) |
| 20:23:11 | — | — | Vault photo `photos/2026-10-01T20-19-26.593Z-finally-laura.webp` attached via the Librarian |
| 20:26:41 | Z.AI GLM 5.1 (Amy) | `glm-5.1`, `supportsImageUpload = 0` | OK. The image was swapped for a text description (`[Image Fallback]`) |
| 20:26:48 | Z.AI GLM 5.3 Flash | `glm-5.3-flash`, `supportsImageUpload = 1` | **400** |
| 20:27:17 | Z.AI GLM 5v Turbo | `glm-5v-turbo`, `supportsImageUpload = 1` | **400** |
| 20:27:40 | Z.AI GLM 4.6V | `glm-4.6v`, `supportsImageUpload = 1` | **400** |
| 20:29:36 | DeepSeek V4 Pro Thinking (NanoGPT) | `deepseek/deepseek-v4-pro:thinking` | OK |

These three are the only occurrences of this error in Friday's `embedded-server.log`. The failed
calls left no `llm_logs` rows.

## Root cause

`loadMountFileAsAttachment` (`lib/chat-files-v2.ts`) returns a `FileAttachment` with both the image
bytes and a URL:

```ts
const url = `/api/v1/mount-points/${mountLink.mountPointId}/blobs/${encodeURI(mountLink.relativePath)}`;
return { id, filepath: url, filename, mimeType, size, data: buffer.toString('base64'), url };
```

`FileAttachment.url` is documented in `@quilltap/plugin-types` as "URL to fetch the file
(alternative to data)", meaning a URL the provider can fetch. This one is a path on the local
Quilltap server, which no provider can reach. `filepath` already carries it for internal use.

The Z.AI and NanoGPT plugins build the `image_url` part with:

```ts
if (attachment.url) return attachment.url;
if (attachment.data) return `data:${attachment.mimeType};base64,${attachment.data}`;
```

So the bytes are dropped and `image_url.url` goes out as `/api/v1/mount-points/…`.

**Reproduction against `api.z.ai`** (2026-10-01, `glm-5.3-flash`, V4test's key, one `image_url` part
after a text part):

| `image_url.url` | Result |
|---|---|
| `data:image/png;base64,…` / `image/jpeg` / `image/webp` | 200, image described correctly |
| WebP data URI, 791 KB, 1024×1024 | 200 |
| `/api/v1/mount-points/701e03fd-…/blobs/photos/2026-10-01T20-19-26.593Z-finally-laura.webp` (the Friday photo's own path) | **400, code 1214, the exact Friday message** |
| `/api/v1/mount-points/701e03fd-…/blobs/story-backgrounds/story_background_1790886460083.webp` | 400, code 1210 (image input format/parse error) |
| `qtap://mount/abc/photo.webp`, or `data:image/webp;base64,` with no bytes | 400, code 1214 |

WebP itself is fine. The first theory, that Z.AI rejects WebP data URLs, was tested and is wrong.

Uploaded chat files (the legacy `files` table branch of `loadChatFilesForLLM`) set no `url`, which
is why plain uploads work and only document-store images fail.

## Why it survived

Most provider plugins read only `data`, so the stray `url` is harmless for them. The two that honour
`url` were written for remote-URL attachments, which this host never produces. Plugin tests feed
hand-built attachments carrying `data` only. Nothing asserts what `loadMountFileAsAttachment` puts in
`url`. A 4xx is classified as our own malformed request (`classifyFallbackTrigger`,
`lib/llm/fallback/engine.ts`), which is correct here, so no fallback ran. Failed calls are not
written to `llm_logs`, so the bad request body was never visible.

## The fix

As built:

1. **Host.** In `loadMountFileAsAttachment`, both the blob branch and the native-text branch, stop
   setting `url`. Keep the internal path in `filepath`. Check that nothing else reads `.url` off a
   chat attachment; a grep on 2026-10-01 found no host reader.
2. **Plugins, defensively.** In the Z.AI and NanoGPT `attachmentToImageUrl`, prefer `data`. Fall
   back to `url` only when it is an absolute `http(s)` URL. Bump both plugins' patch versions and
   rebuild with `npm run build:plugins`.
3. Consider documenting in `@quilltap/plugin-types` that `url` must be fetchable by the provider.

## How to verify

1. In V4test, with the `Z_AI/glm-5.3-flash` profile, attach a character-vault photo to a chat and
   send a turn. It should answer and describe the photo.
2. Repeat on a NanoGPT vision profile.
3. Confirm an uploaded (non-vault) image attachment still works on both.
4. Add a unit test that `loadMountFileAsAttachment` returns `data` and no relative `url`, and plugin
   tests showing that an attachment with both `data` and a relative `url` is sent as a `data:` URI.
