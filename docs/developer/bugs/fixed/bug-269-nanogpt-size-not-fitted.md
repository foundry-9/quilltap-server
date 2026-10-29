# Bug 269 — NanoGPT posts a size the model does not list, so every Qwen Image 3 avatar is a 400

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-27, live on `Friday` (chat `9952729a-5a41-4ac7-995b-728bf70b3a02`), from the operator's report that no avatars were arriving |
| **Fixed** | 2026-10-27 |
| **Severity** | Medium. Every avatar and every story background on an affected model fails, three attempts per job, with nothing in the Salon but missing pictures |
| **Who it bites** | anyone whose image profile points at a NanoGPT model that does not list `832x1248` / `1248x832` — the Qwen Image 3 family (`1k` / `2k` tiers), the `W*H` models (`qwen-image-2.0`, `qwen-image-max`), and any other model with its own size list |
| **Provenance** | The NanoGPT plugin declares one provider-wide `orientationSupport` (portrait `832x1248`, landscape `1248x832`) and no per-model mapping, so the host's `resolveOrientation` always posts those sizes. The plugin forwarded `size` as given; the per-model `resolutions` from the detailed catalog fed only the profile editor's size picker. `qwen-image-3-uncensored` lists only `1k` and `2k` with the shape in a separate `aspect_ratio` field, and NanoGPT answered `400 "Qwen Image 3 Uncensored supports 1K and 2K output."` |
| **Fix site** | `plugins/dist/qtap-plugin-nanogpt/image-sizes.ts` (new), `plugins/dist/qtap-plugin-nanogpt/image-provider.ts` (`generateImage`, `catalogEntryFor`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-27).** The plugin fits the request to the model at the wire. `fitImageShape`
reads the model's catalog entry and picks the nearest listed concrete size by aspect ratio (in the
model's own spelling, `x` or `*`), or, for a tier model, the nearest tier by long edge plus the
nearest listed `aspect_ratio`, posted as a flat body key. `generateImage` fetches the catalog when
its module cache is cold, which is always the case in the job child, since the child never lists
models. A failed fetch is logged and the size goes out as asked.

A non-square request that is then refused on its shape gets one retry as a square, from the same
fit (`1k` + `1:1` on Qwen Image 3, `1024x1024` with no catalog entry). "Refused on its shape" means
a 400 whose message names a size, resolution, aspect, dimension or output, or a 503. This was the
operator's suggestion. On 2026-10-27, NanoGPT answered every non-square `aspect_ratio` on
`qwen-image-3-uncensored` (`2:3`, `3:4`, `9:16`, `4:5`, `3:2`) with an uncharged
`503 provider_transient_error` while `1:1` succeeded at once, so without the retry a correctly
fitted portrait still produced no picture. Until NanoGPT serves non-square output, portraits on
that model arrive square.

Plugin `qtap-plugin-nanogpt` 1.2.10 → 1.2.11. Verified live against NanoGPT with the built plugin:
a `832x1248` request on `qwen-image-3-uncensored` was fitted to `1k` / `2:3`, received the 503,
retried as `1k` / `1:1`, and returned a 1024×1024 image.

## Symptom

In the chat, the opening-outfit avatar jobs for all three characters, and a manual regenerate,
failed. `embedded-server.log` shows each job running three times and going `DEAD`:

```
NanoGPT image request failed  model="qwen-image-3-uncensored" size="832x1248"
  error="400 \"Qwen Image 3 Uncensored supports 1K and 2K output.\""
Background job marked as DEAD (max attempts reached)
```

All 70 instances of the error were from that morning. The earlier `Qwen 2.1 LoRA` profile
(`qwen-image-2.1/text-to-image-lora`) had worked, because NanoGPT maps a pixel size onto that model.

## Root cause

`lib/image-gen/orientation.ts` resolves `portrait` through the per-model `orientationSupport`
first, then the provider's. `getNanoGPTImageModels()` declares none per model, so the lookup lands
on `NANOGPT_IMAGE_CONSTRAINTS.orientationSupport` (`plugins/dist/qtap-plugin-nanogpt/index.ts:72`),
which is `832x1248`. `NanoGPTImageProvider.generateImage` posted that `size` unchanged.

The detailed catalog (`GET /api/v1/image-models?detailed=true`) uses three size dialects across
its ~250 models:

- `WxH` (`1024x1536`)
- `W*H` (`1024*1536`)
- resolution tiers (`1k`, `1.5k`, `2k`) with a separate `supported_parameters.aspect_ratio` list

Live probes on 2026-10-27 confirmed the wire format for tier models: `size: "1k"` is accepted, a
snake_case `aspect_ratio` is read and validated (`"7:5"` → `400 "Unsupported … aspect ratio."`),
and a camelCase `aspectRatio` is ignored.

## Why it survived

The catalog's `resolutions` was used only to build the profile editor's size picker. The host's
orientation mapping overrides the profile's chosen size, so a profile set to `1k` still posted
`832x1248`. Earlier NanoGPT models accepted the provider-wide sizes and mapped them to their
nearest native resolution, so nothing had failed before.

## How to verify

- `npx jest __tests__/unit/plugins/nanogpt-image-sizes.test.ts`: the fit for tier, `W*H` and
  uncatalogued models, the cold-cache catalog fetch, and the square retry (503, a size 400, no
  retry for an unrelated 400 or an already-square request).
- In an instance, point an image profile at `qwen-image-3-uncensored` and regenerate a character's
  avatar. The log shows `Fitted the requested image shape to the model … size="1k" aspectRatio="2:3"`.
  While NanoGPT's non-square outage lasts, it also shows the square retry warning, and the avatar
  arrives square.
