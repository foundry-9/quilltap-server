# Bug 197 — Import-from-image's vision call skips the shared image-transport safeguards

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../features/wardrobe-refactor.md) |
| **Fixed** | — |
| **Severity** | Low — a wasteful or failing call, not a wrong write; but it reintroduces the bug 91 and bug 151 classes on one path |
| **Who it bites** | anyone importing wardrobe items from a photograph, especially with a large upload or a vision profile whose plugin drops image bytes |
| **Provenance** | Original to v4. `image-analysis.ts` hand-rolled its own profile pick and provider call before `lib/llm/image-transport.ts` and `lib/files/llm-image-budget.ts` existed, and was not revisited when they did |
| **Defect site** | `lib/wardrobe/image-analysis.ts:93,107` (`profileSupportsMimeType` instead of `profileCanReceiveAttachment`, the documented single predicate at `lib/llm/image-transport.ts:70`); `:104` (`connections.findAll()` rather than the user's); `:336-381` (`provider.sendMessage` directly: no `shrinkImageForLlmTransport`, no attachment-arrival check from `lib/chat/file-attachment-fallback.ts:68-127`, no reasoning-model `maxTokens` bump) |
| **Fix site** | proposed: Phase E of the plan — one `resolveVisionProfile(repos, userId, { prefer })` shared with the attachment fallback, and a `sendVisionRequest` split out of `describeImageWithProfile` that shrinks, verifies arrival and logs |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

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
