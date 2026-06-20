# Feature: Image Orientation Gating & Resolution Negotiation

**Status:** Implemented (4.7-dev, 2026-06-13)
**Subsystem:** The Lantern (images) · provider plugins · `lib/tools/`
**Author:** design plan

> Implemented. Resolver at `lib/image-gen/orientation.ts`; registry accessor
> `getImageGenerationModels` in `lib/plugins/provider-registry.ts`; contract
> types in `@quilltap/plugin-types` 2.5.2; built-in plugins wired (openai 1.0.50,
> google 1.1.38, grok 1.0.41, z-ai 1.1.12, openrouter 1.0.46). Notable deltas
> from the original plan, confirmed during implementation: the registry had no
> `getImageGenerationModels` accessor (added); OpenAI gained a
> `getImageGenerationModels` returning all six image models so the profile UI
> list did not regress; Z.AI already advertises non-square sizes so it uses the
> `size` strategy (no prompt fallback needed); DALL·E 2 omits portrait/landscape
> (degrades to a prompt hint); aspect-ratio providers use portrait 3:4 /
> landscape 16:9 per a confirmed product decision. Dimensions are measured in
> `convertToWebP` (one chokepoint covering all three paths and their reroutes).

## Problem

Quilltap generates images on three paths — character avatars (Aurora), story
backgrounds (the Lantern), and the inline `generate_image` tool — and each one
guesses at dimensions in a way that is wrong for half the providers:

- `lib/background-jobs/handlers/character-avatar.ts` hard-codes
  `size: '1024x1792'` and then stores `width: 1024, height: 1792` regardless of
  what the provider actually returned.
- `lib/background-jobs/handlers/story-background.ts` hard-codes
  `size: '1792x1024'` and stores `width: 1792, height: 1024`.
- `lib/tools/image-generation-tool.ts` exposes a fixed `size` enum
  (`1024x1024 | 1792x1024 | 1024x1792`) and a fixed `aspectRatio` enum, neither
  of which most providers honour.

Providers disagree fundamentally on **how** shape is requested:

- OpenAI / Z.AI take a concrete `size` string, and the legal set is **per
  model** (gpt-image vs DALL·E 3 vs DALL·E 2 each differ).
- Google Imagen, Google Gemini, Grok, and OpenRouter take an **`aspect_ratio`**
  and reject `size`.
- Some current and future providers (and any local/diffusion plugin) can only
  influence shape **through the prompt wording**.

The hard-coded sizes silently map to `1024x1024` on gpt-image (which has no
`1024x1792`), so avatars that are supposed to be portrait come back square, and
the stored dimensions lie about it.

## Goal

A single, provider-agnostic way to ask for an image **orientation**
(`portrait | landscape | square`) that:

1. Every provider can satisfy, by mapping orientation onto whatever its API
   actually supports — concrete size, aspect ratio, or prompt wording.
2. Providers advertise their real capabilities (preferred portrait/landscape
   shape, full supported size/aspect lists, and whether shape is prompt-only) so
   the host and the LLM tool only offer choices that will work.
3. Always offers `portrait` and `landscape` as options on every path.
4. Defaults avatars to `portrait` and story backgrounds to `landscape`.
5. Records the *actual* returned dimensions instead of trusting the request.

## Design decisions (confirmed)

- **Core abstraction is semantic orientation.** Callers and the `generate_image`
  tool speak `portrait | landscape | square`. The provider resolves that to its
  own best size / aspect / prompt-hint. (Optional exact-size selection is a
  later add-on, not v1.)
- **Prompt-only providers declare it.** A provider whose API can't take a shape
  parameter advertises `orientationStrategy: 'prompt'` and supplies per-
  orientation prompt phrases; the host appends the phrase and flags the stored
  dimensions as best-effort.
- **Full per-provider audit** is included below so implementation is mechanical.

---

## Core abstraction

### New type: `ImageOrientation`

```ts
// packages/plugin-types/src/providers/image.ts
export type ImageOrientation = 'portrait' | 'landscape' | 'square';
```

Add an optional `orientation` to `ImageGenParams` (keep `size`/`aspectRatio` for
back-compat and for the optional exact-selection path later):

```ts
export interface ImageGenParams {
  prompt: string;
  // ... existing fields ...
  /** Semantic shape intent. When set, the provider maps it onto its own
   *  supported size / aspect ratio / prompt wording. Takes precedence over
   *  size/aspectRatio when the provider has a mapping for it. */
  orientation?: ImageOrientation;
}
```

### Extending the capability declaration

The contract already has `ImageProviderConstraints` and
`ImageGenerationModelInfo` (`packages/plugin-types/src/plugins/provider.ts`) and
the registry already exposes `getImageProviderConstraints(name)`
(`lib/plugins/provider-registry.ts`). We extend, not replace.

Add an orientation map describing how this provider satisfies each orientation,
plus the strategy flag:

```ts
// packages/plugin-types/src/plugins/provider.ts

export type OrientationStrategy = 'size' | 'aspectRatio' | 'prompt';

/** How a provider realises one orientation. Exactly one of size/aspectRatio is
 *  set for 'size'/'aspectRatio' strategies; promptHint is set for 'prompt'. */
export interface OrientationMapping {
  /** Concrete size string, when orientationStrategy === 'size' (e.g. '1024x1536'). */
  size?: string;
  /** Aspect ratio, when orientationStrategy === 'aspectRatio' (e.g. '9:16'). */
  aspectRatio?: string;
  /** Phrase appended to the prompt, when orientationStrategy === 'prompt'. */
  promptHint?: string;
  /** Nominal pixel dims for this orientation, used for UI hints only. The
   *  host still measures the actual returned image. */
  nominalWidth?: number;
  nominalHeight?: number;
}

export interface ImageOrientationSupport {
  /** Primary mechanism this provider uses to control shape. */
  strategy: OrientationStrategy;
  /** Per-orientation realisation. `square` SHOULD be present; `portrait` and
   *  `landscape` MUST be present so the host can always offer them. */
  portrait: OrientationMapping;
  landscape: OrientationMapping;
  square?: OrientationMapping;
}
```

Extend `ImageProviderConstraints` and `ImageGenerationModelInfo`:

```ts
export interface ImageProviderConstraints {
  // ... existing fields ...
  /** Default orientation support when no model-specific override applies. */
  orientationSupport?: ImageOrientationSupport;
}

export interface ImageGenerationModelInfo {
  // ... existing fields ...
  /** Per-model orientation support, overriding the provider-level default.
   *  Required for providers (OpenAI, Z.AI) whose legal sizes differ by model. */
  orientationSupport?: ImageOrientationSupport;
}
```

> **Why model-keyed.** OpenAI is the proof case: gpt-image portrait is
> `1024x1536`, DALL·E 3 portrait is `1024x1792`, DALL·E 2 has no portrait at
> all (square only). A provider-level map can't express that; an optional
> per-model override can.

### Resolution at call time — one host helper

A single host-side resolver turns `(provider, model, orientation)` into the
concrete request mutation, so no caller re-implements the mapping:

```ts
// lib/image-gen/orientation.ts  (new)

import { getImageProviderConstraints, getImageGenerationModels }
  from '@/lib/plugins/provider-registry';
import type { ImageOrientation, ImageGenParams } from '@quilltap/plugin-types';

export interface ResolvedOrientation {
  /** Mutations to merge into ImageGenParams before calling generateImage. */
  params: Partial<Pick<ImageGenParams, 'size' | 'aspectRatio'>>;
  /** Phrase to append to the prompt (prompt-strategy providers), else ''. */
  promptHint: string;
  /** Whether the returned dimensions are trustworthy a priori. False for
   *  prompt-strategy providers — caller MUST measure the result. */
  dimensionsAuthoritative: boolean;
  /** Nominal dims for UI/optimistic display only. */
  nominalWidth?: number;
  nominalHeight?: number;
}

export function resolveOrientation(
  provider: string,
  model: string | undefined,
  orientation: ImageOrientation,
): ResolvedOrientation;
```

Lookup order inside `resolveOrientation`:

1. Per-model `orientationSupport` (from `getImageGenerationModels()`), matched on
   `model`.
2. Provider-level `orientationSupport` (from `getImageProviderConstraints()`).
3. **Host fallback** — generic prompt hints (`'vertical portrait composition,
   taller than wide'` / `'wide landscape composition, wider than tall'` /
   `'square composition'`) with `dimensionsAuthoritative: false`. Guarantees
   portrait/landscape always resolve to *something* even for a plugin that
   declares nothing.

For `strategy: 'size'` it sets `params.size`; for `'aspectRatio'` it sets
`params.aspectRatio`; for `'prompt'` it returns a `promptHint` and leaves both
unset.

### Measuring actual dimensions (fixes the stored-dimension lie)

`sharp` is already used in `lib/files/webp-conversion.ts`. After conversion,
read back real dimensions and store those everywhere instead of the hard-coded
constants:

```ts
const meta = await sharp(webpBuffer).metadata();
// store meta.width / meta.height on the file record
```

This is mandatory for prompt-strategy providers and harmless (and more correct)
for the others.

---

## Per-provider capability audit

Built-ins live under `plugins/dist/qtap-plugin-*/image-provider.ts`. Findings
from reading each file:

| Provider (`provider`) | Mechanism | Portrait | Landscape | Square | Notes |
|---|---|---|---|---|---|
| **OpenAI** gpt-image-* | `size` (per model) | `1024x1536` | `1536x1024` | `1024x1024` | also `auto`; no quality/style on gpt-image |
| **OpenAI** dall-e-3 | `size` | `1024x1792` | `1792x1024` | `1024x1024` | takes quality + style |
| **OpenAI** dall-e-2 | `size` | — (fallback square) | — (fallback square) | `1024x1024` | only square set; deprecated 2026-05-12 |
| **Google** imagen-4 / -fast | `aspectRatio` | `3:4` (or `9:16`) | `4:3` (or `16:9`) | `1:1` | `:predict`; empty result = moderation block |
| **Google** gemini-2.5-flash-image, gemini-3-pro-image-preview | `aspectRatio` via `imageConfig` | `3:4`/`9:16` | `4:3`/`16:9` | `1:1` | `:generateContent` |
| **Grok** grok-imagine-image(-pro) | `aspect_ratio` | `9:16` | `16:9` | `1:1` | `-pro` forces `resolution:'2k'` |
| **Grok** grok-2-image (legacy) | `aspect_ratio` | `9:16` | `16:9` | `1:1` | |
| **Z.AI** cogview-4-250304 | `size` | `1024x1536`* | `1536x1024`* | `1024x1024` | *verify legal set against Z.AI docs |
| **Z.AI** glm-image | `size` | `1280x1536`* | `1536x1280`* | `1280x1280` | default square is `1280x1280`; *verify |
| **OpenRouter** (gemini/gpt-5-image passthrough) | `aspect_ratio` via `image_config` | `9:16` | `16:9` | `1:1` | models discovered dynamically; `quality:'hd'` → `image_size:'4K'` |

Pick **one** preferred portrait/landscape per row for the `orientationSupport`
map (the parenthetical alternates are the wider 16:9/9:16 option — choose
`3:4`/`4:3` for avatars-friendly framing, `16:9`/`9:16` for cinematic
backgrounds; recommend `3:4`/`4:3` as the provider default and let backgrounds
pass an explicit cinematic preference later if desired).

**Action item flagged for implementation:** the two `*` Z.AI rows are inferred,
not confirmed from the SDK (Z.AI talks raw OpenAI-shape HTTP). Confirm the legal
`size` set from Z.AI's API docs before wiring; if non-square sizes aren't
supported, set Z.AI `strategy: 'prompt'` instead.

---

## Wiring each plugin

For each built-in plugin's `index.ts`, implement / extend:

- `getImageProviderConstraints()` → return `orientationSupport` (provider-level
  default) where the provider is uniform across models (Grok, Google,
  OpenRouter).
- `getImageGenerationModels()` → add per-model `orientationSupport` where legal
  sizes vary by model (OpenAI, Z.AI).
- Each provider's `generateImage` already reads `params.size` /
  `params.aspectRatio`; **no change needed inside the providers** because the
  host resolver writes those fields before the call. Prompt-strategy providers
  need nothing because the host appends the hint to `params.prompt`.

This keeps the providers dumb and the mapping centralised — consistent with the
"Zod input schema is the single source of truth / don't duplicate" ethos in
CLAUDE.md.

---

## Wiring each call path

### 1. Inline tool — `lib/tools/image-generation-tool.ts`

- Add `orientation: z.enum(['portrait','landscape','square']).optional()` to
  `imageGenerationToolInputSchema`, described so the LLM prefers it over raw
  size. Keep `size`/`aspectRatio` for advanced/back-compat use but mark them as
  provider-dependent in their `.describe()`.
- Per the tool-definition chokepoint rules: schema stays the single source of
  truth, `parameters` stays derived via `zodToOpenAISchema`, and
  `validateImageGenerationInput` stays a one-line `safeParse`. **Re-run
  `npx jest -u` on `lib/tools/__tests__/tool-definitions-snapshot.test.ts`.**
- Replace the hand-rolled `getProviderConstraints()` switch with a call into the
  registry-backed constraints + `resolveOrientation`, so the dropdown of
  legal choices is data-driven, not a stale switch statement.
- In `lib/tools/handlers/image-generation-handler.ts`, before
  `provider.generateImage(...)`: call `resolveOrientation(provider, model,
  input.orientation ?? 'square')`, merge `params`, append `promptHint` to the
  expanded prompt, and after WebP conversion store measured dims.

### 2. Avatars — `lib/background-jobs/handlers/character-avatar.ts`

- Remove `size: '1024x1792'`. Call
  `resolveOrientation(profile.provider, profile.modelName, 'portrait')`
  (**default portrait**), merge into the `generateImage` params, append any
  `promptHint` to `prompt`.
- Replace the two hard-coded `width: 1024, height: 1792` on the stored file
  record with measured dims. Apply to the reroute path too.

### 3. Story backgrounds — `lib/background-jobs/handlers/story-background.ts`

- Remove `size: '1792x1024'`. Call
  `resolveOrientation(profile.provider, profile.modelName, 'landscape')`
  (**default landscape**). Append `promptHint`. Apply to reroute path.
- Replace the hard-coded `width: 1792, height: 1024` with measured dims.

> Both background handlers run in the forked child (parent is the only DB
> writer). `resolveOrientation` is pure (reads the in-process plugin registry,
> no DB), so it is safe to call inside a handler. Measuring dims happens before
> the buffered write, which is fine.

---

## Persistence & schema touchpoints

Per CLAUDE.md's data/schema checklist, review whether orientation needs to
persist:

- **Image profile** (`lib/schemas/profile.types.ts`): optionally add a default
  orientation preference per profile later; **not required for v1** (defaults
  are per-call: avatars portrait, backgrounds landscape). If added, reflect in
  `.qtap` export, `qtap-export.schema.json`, backups, and DDL.md.
- **File record dimensions** already exist (`width`/`height`); we are only
  changing them from hard-coded to measured. No schema change, but note in
  `docs/developer/DDL.md` if the semantics ("now always actual") are documented
  anywhere.
- No new SQLite columns required for v1.

---

## Testing strategy

- **Unit — `resolveOrientation`**: table-driven test over the audit matrix:
  every (provider, model, orientation) yields the expected size/aspectRatio/
  promptHint and the correct `dimensionsAuthoritative`. Include the host-
  fallback case (unknown provider → prompt hints, non-authoritative).
- **Unit — providers**: assert each plugin's `getImageProviderConstraints()` /
  `getImageGenerationModels()` returns portrait + landscape mappings (contract
  test that fails if a future plugin omits them).
- **Snapshot**: `npx jest -u` for the tool-definitions snapshot after adding
  `orientation` to the schema.
- **Handler tests**: avatar handler defaults to portrait, background handler to
  landscape; both store *measured* dims (mock sharp to return known dims and
  assert the file record matches, proving the hard-coded constants are gone).
- **Type-check**: `npx tsc` (not `npm run build`).

## Documentation & process (CLAUDE.md standing rules)

- `docs/CHANGELOG.md`: plain-voice entry.
- User-visible help: the Lantern (`?tab=images`) and any image-tool help under
  `help/*.md` gain an "orientation" note with the `url` frontmatter +
  In-Chat-Navigation `help_navigate(...)` block. Voice: steampunk / Roaring-20s
  / Wodehouse / Lemony Snicket.
- **Plugin version bumps:** every touched `plugins/dist/qtap-plugin-*` needs a
  patch bump in its `package.json` (and `manifest.json` if changed), then
  `npm run build:plugins` before staging — this is a hard stop in CLAUDE.md.
- **`packages/plugin-types` change is a hard stop:** adding `ImageOrientation`,
  `OrientationStrategy`, `OrientationMapping`, `ImageOrientationSupport` and the
  new optional fields means bumping `packages/plugin-types`, then **stopping to
  ask the human to `npm publish`** before anything that installs it. Do not
  hand-copy.

## Implementation order

1. `packages/plugin-types`: add the types (then **stop, request publish**).
2. `lib/image-gen/orientation.ts`: the resolver + host fallback + unit tests.
3. Wire built-in plugins' constraints/model-info (bump + `build:plugins`).
4. Switch the three call paths to the resolver; measure dims via sharp.
5. Add `orientation` to the tool schema; `jest -u` snapshot.
6. Help docs + CHANGELOG; `npx tsc`; commit via `/commit`.

## Open questions / deferred

- Backgrounds: keep `3:4`/`4:3` default or prefer cinematic `16:9`/`9:16` for
  aspect-ratio providers? (Recommend a per-orientation *preference hint* the
  caller can pass; backgrounds pass `cinematic`, avatars don't.)
- Optional exact-resolution selection (the "orientation + optional exact"
  variant) — additive later via the already-present `supportedSizes` /
  `supportedAspectRatios` constraint fields.
- Z.AI non-square `size` legality — **must confirm** before wiring (see audit).
