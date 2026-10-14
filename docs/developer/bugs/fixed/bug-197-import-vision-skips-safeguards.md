# Bug 197 — Import-from-image's vision call skips the shared image-transport safeguards

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../../features/complete/wardrobe-refactor.md) |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | Low — a wasteful or failing call, not a wrong write; but it reintroduces the bug 91 and bug 151 classes on one path |
| **Who it bites** | anyone importing wardrobe items from a photograph, especially with a large upload or a vision profile whose plugin drops image bytes |
| **Provenance** | Original to v4. `image-analysis.ts` hand-rolled its own profile pick and provider call before `lib/llm/image-transport.ts` and `lib/files/llm-image-budget.ts` existed, and was not revisited when they did |
| **Defect site** | `lib/wardrobe/image-analysis.ts:93,107` (`profileSupportsMimeType` instead of `profileCanReceiveAttachment`, the documented single predicate at `lib/llm/image-transport.ts:70`); `:104` (`connections.findAll()` rather than the user's); `:336-381` (`provider.sendMessage` directly: no `shrinkImageForLlmTransport`, no attachment-arrival check from `lib/chat/file-attachment-fallback.ts:68-127`, no reasoning-model `maxTokens` bump) |
| **Fix site** | `lib/llm/vision-request.ts` (new: `resolveVisionProfile`, `sendVisionRequest`, `verifyImageReachedModel` moved here and made instruction-aware); `lib/chat/file-attachment-fallback.ts` (`describeImageWithProfile` and the describer pick use them); `lib/wardrobe/image-analysis.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** A new `lib/llm/vision-request.ts` holds the shared vision path.
`resolveVisionProfile(repos, userId, { prefer, configured })` picks with `profileCanReceiveAttachment` among
the user's own profiles (`findByUserId`, not `findAll`); Import from image asks for `prefer: 'capable'`
and passes over a configured describer that cannot receive images, the describe-fallback keeps
`prefer: 'cheap'` and honours its configured describer so the refusal can say why.
`sendVisionRequest` was split out of `describeImageWithProfile` and both use it: the capability check,
`shrinkImageForLlmTransport` on the bytes, a hard timeout, the `llm_logs` row, and
`verifyImageReachedModel`, which now takes the request's own text (system prompt plus instruction) to set
its token ceiling instead of the describe instruction's fixed one. An analysis the model gave without the
image is refused with a 400 rather than turned into wardrobe items. Import from image also uploads the
photograph once and links it to every other piece (`?action=link-image`, `linkWardrobeItemImage`) instead of
uploading it per piece. The reasoning-model `maxTokens` bump was not needed: the analysis already asks for
4000. Tests in `__tests__/unit/lib/wardrobe/image-analysis.test.ts`,
`__tests__/unit/lib/chat/file-attachment-fallback.test.ts`,
`__tests__/unit/lib/wardrobe/item-images.link.test.ts` and
`__tests__/unit/components/wardrobe/import-from-image-modal.outfit.test.tsx`.

## Symptom

A 10 MB photograph goes to the vision model at full size (bug 151's class). A
profile ticked "vision" whose plugin cannot actually carry image bytes is
chosen and the model describes an imagined garment (bug 91's class; the
attachment-arrival check that catches it elsewhere does not run here).

## Root cause

`findVisionProfile` duplicates `getImageDescriptionProfile` with an older
predicate, and `runAnalyzeImageForWardrobeItems` calls the provider without
the transport helpers every other vision path uses. The one intentional
difference (prefer a non-cheap profile for quality) is commented and should
survive as an option.

## Why it survived

Most uploads are small and most vision profiles do carry bytes.

## Fix (proposed)

- `resolveVisionProfile(repos, userId, { prefer: 'cheap' | 'quality' })`
  exported from the attachment-fallback module, built on
  `profileCanReceiveAttachment`, used by both callers.
- `sendVisionRequest({ profile, image, system, user, maxTokens })` holding the
  transport half of `describeImageWithProfile` (shrink, send, arrival check,
  log). The wardrobe analyser supplies only its prompt and parser.

## How to verify

Import from a >5 MB photograph with debug logging on: the logged attachment
must be at or under `LLM_TRANSPORT_TARGET_BASE64`. With a profile whose
plugin drops images, the call must be refused before the model answers.
