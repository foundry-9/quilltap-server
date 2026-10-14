# Bug 149 — the injected default orientation erases an explicit `size`, so `generate_image`'s `size` parameter has never done anything

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-16)** |
| **Found** | 2026-09-16, by a Copilot review comment on [PR #62](https://github.com/foundry-9/quilltap-server/pull/62), while adding GPT Image 2.5 |
| **Fixed** | 2026-09-16 |
| **Severity** | **Low-Medium** — nothing lost, and the picture is always *a* picture. But a documented tool parameter is inert: a character asking for `1536x1024` silently gets a 1024x1024 square, and the profile's own default size is discarded at the same time |
| **Who it bites** | any character calling `generate_image` with `size` and no `orientation`, on a provider that honours exact sizes (OpenAI). Also every such call's *profile* default size, which the same line overwrites |
| **Provenance** | Original to v4 |
| **Fix site** | `lib/tools/handlers/image-generation-handler.ts` (`requestedOrientation`, consumed at both `buildImageGenParams` call sites) |
| **v5 status** | **Not yet assessed.** The shape to avoid: defaulting a *precedence-carrying* optional before the layer that applies the precedence |
| **Index** | [bugs.md](../../bugs.md) |

---

## FIXED in v4 (2026-09-16)

The default is no longer injected when the caller supplied a size of its own.
A new `requestedOrientation(toolInput)` returns the explicit orientation when
there is one, `undefined` when the model named a size, and `'square'` only when
it asked for neither. Both call sites — the ordinary path and the Concierge
reroute — consume it, so the two cannot drift.

---

## Symptom

A character calls `generate_image` with `size: '1536x1024'` and no
`orientation`. The image comes back 1024x1024. Nothing errors, nothing logs a
complaint, and the `[Image Params]` debug line shows `size: '1024x1024'` — a
value neither the model nor the profile ever asked for.

The same line also discards the profile's configured default size, since it is
`params.size` that gets overwritten, whatever put it there.

## Root cause

Two things, each correct alone:

`buildImageGenParams` lets orientation outrank a raw size, deliberately and with
a comment saying so — *"Orientation outranks any raw size/aspectRatio that
arrived above: the caller asked for a shape, not for a string."* That is right.

The handler then passed:

```ts
orientation: toolInput.orientation ?? 'square',
```

so the builder was told a shape had been requested on *every* call. The
precedence therefore applied unconditionally, and `square`'s mapping —
`1024x1024` for every OpenAI family — landed on top of whatever `size` the merge
had produced. There is no input for which the tool's `size` survives: supply it
alone and the injected `'square'` replaces it; supply it with an orientation and
that orientation replaces it, as intended.

## Why it survived

- **Both halves read correctly in isolation.** The builder's precedence is
  documented and right; `?? 'square'` looks like an ordinary default for an
  optional field. The bug is only visible with both files open.
- **The tool's own description steers models away from `size`.** It is marked
  *"Advanced, provider-dependent … Prefer `orientation`"*, so the parameter is
  rarely used, and a square is a plausible-looking result when it is.
- **`square` is a real orientation, not a sentinel.** Had the default been
  `undefined`, the builder would have skipped resolution and the size would have
  survived; choosing a *valid value* as the default is what made it destructive.
- **No test covered the combination.** `params-builder` tests pin that
  orientation outranks size — the behaviour that is correct — and the handler
  had no test asserting what it passes.

## The fix

```ts
export function requestedOrientation(
  input: ImageGenerationToolInput,
): ImageOrientation | undefined {
  if (input.orientation) {
    return input.orientation;
  }
  return input.size ? undefined : 'square';
}
```

`undefined` is the builder's documented "leave `size`/`aspectRatio` exactly as
the merge produced them" — the same thing `POST /api/v1/images` already passes,
precisely because that route's caller means its explicit size. Square remains
the default for the overwhelmingly common case where the model asks for neither.

The builder is untouched: its precedence was never the problem.

## How to verify

`__tests__/unit/lib/tools/image-generation-orientation.test.ts` — four cases,
one of them red against the old expression:

```ts
expect(requestedOrientation(input({ size: '1536x1024' }))).toBeUndefined();  // was 'square'
```

The other three pin what must *not* change: a bare call still defaults to
square, an explicit orientation is still honoured, and orientation still wins
when the model supplies both.

End to end: ask a character for an image with `size: '1536x1024'` on an OpenAI
profile and read the `[Image Params] Built image generation parameters` line —
it now carries the requested size rather than `1024x1024`.
