# Bug 148 — the `generate_image` schema's Zod defaults are sent as overrides, so a profile's size, quality and style are never used

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-16)** |
| **Found** | 2026-09-16, while adding GPT Image 2.5 support — the new premium quality tiers could be stored on a profile and never reached the wire |
| **Fixed** | 2026-09-16 |
| **Severity** | **Medium** — no data loss, but three image-profile settings were silently inert for every image a character generated in chat. Latent since the fields were given defaults; surfaced only now because GPT Image 2.5 made the quality field worth setting |
| **Who it bites** | anyone who configures Size, Quality or Style on an image profile and then asks a character for a picture. The profile page shows their choice; the request carries something else |
| **Provenance** | Original to v4 |
| **Fix site** | `lib/tools/image-generation-tool.ts` (`imageGenerationToolInputSchema` — the `size`, `quality` and `style` fields) |
| **v5 status** | **Not yet assessed.** v5 must not carry the shape: any tool schema whose output is fed to a call site as *overrides* cannot also carry `.default()` |
| **Index** | [bugs.md](../../bugs.md) |

---

## FIXED in v4 (2026-09-16)

`.default(...)` removed from `size`, `quality` and `style`. An absent key now
parses to `undefined`, which is what `firstNonEmptyString` in the params
builder reads as "unset" — so the profile's stored value stands, exactly as the
builder was always written to allow. `count` deliberately keeps its default;
see *What was left alone*.

---

## Symptom

An image profile configured with, say, Quality `hd` (or, after GPT Image 2.5,
`max`) generated images at the provider's own default instead. Same for a
non-square default Size, and for Style on DALL·E 3. Nothing failed, nothing
logged an error, and the profile editor went on displaying the setting the user
had chosen — so the only way to notice was to compare the picture you got with
the one you asked for.

## Root cause

Three fields in `imageGenerationToolInputSchema` were declared
`.default(x).optional()`:

```ts
size:    z.enum([...]).default('1024x1024').optional(),
style:   z.enum([...]).default('vivid').optional(),
quality: z.enum([...]).default('standard').optional(),
```

In Zod 4, `.default(x).optional()` still applies the default when the key is
**absent** — `schema.parse({ prompt })` returns `{ quality: 'standard', … }`,
not `{ prompt }`. (`.optional()` widens the output type; it does not suppress
the inner default.)

That output goes straight to `toolInputOverrides`
(`lib/tools/handlers/image-generation-handler.ts:234-243`), which hands it to
`buildImageGenParams` as the **`overrides`** slice. And overrides are, by
design, the thing that outranks the profile:

```ts
// lib/image-gen/params-builder.ts
const quality = firstNonEmptyString(overrides.quality, defaults.quality);
```

`overrides.quality` was never empty, so `defaults.quality` — the profile's
stored setting — was never consulted. The defaults were written as *fallbacks*
and consumed as *the user's explicit instruction*.

## Why it survived

- **The builder's contract is right and the schema's is right; only their
  meeting is wrong.** Read either file alone and nothing looks amiss. A
  `.default()` on an input schema is ordinary, and so is "overrides outrank
  stored defaults."
- **`orientation` masks it for `size`.** When a model passes `orientation`
  — which the schema's own description tells it to prefer — the resolver
  overwrites `params.size` afterwards, so the wrong size was corrected before
  it could be seen. The exposure was only on requests that gave neither.
- **`standard` and `vivid` were plausible.** They are the values a DALL·E user
  would likely have picked anyway, so the pictures looked right. GPT Image 2.5
  is what made the silence loud: `standard` is not one of its tiers at all, so
  the setting a user had deliberately raised to `max` arrived as a value the
  model rejects.
- **No test parsed an empty input.** The snapshot test pins the derived JSON
  Schema — which faithfully recorded `"default": "standard"` as correct output
  for the schema as written — and nothing asserted on what `parse({ prompt })`
  actually returns.

## The fix

Drop the three `.default(...)` calls. Their descriptions now tell the model to
omit the field to use the profile's setting, which is also the honest
instruction: the profile is where these belong.

The same change widened the enums for GPT Image 2.5 (`quality` gains `auto`,
`low`, `medium`, `high`, `xhigh`, `max`; `size` gains the standard GPT Image
`1536x1024` / `1024x1536`), but that is the feature, not the fix — the defaults
were wrong at every one of the old values too.

### What was left alone

`count` keeps `.default(1)`. It is the one field of the four where the default
is also the safe and the cheap answer, its description promises the model a
default of 1, and no OpenAI image-profile editor exposes `n` for the default to
override. Removing it would mean a profile storing `n: 3` quietly tripling the
cost of every image a character asks for — a surprise in the opposite
direction. Recorded here so the asymmetry reads as a decision rather than an
oversight.

## How to verify

`__tests__/unit/lib/tools/image-generation-tool-defaults.test.ts` — the first
case is red against the old schema and green against the new:

```ts
const parsed = imageGenerationToolInputSchema.parse({ prompt: 'a brass zeppelin' });
expect(parsed).not.toHaveProperty('quality');   // was 'standard'
expect(parsed).not.toHaveProperty('size');      // was '1024x1024'
expect(parsed).not.toHaveProperty('style');     // was 'vivid'
```

End to end: set an image profile's Quality to something distinctive, ask a
character for a picture without naming a quality, and read the
`[Image Params] Built image generation parameters` debug line — it now carries
the profile's value rather than `standard`.

The tool-definition snapshot was regenerated (`npx jest -u`); its diff is the
three `"default"` keys disappearing and the two widened enums.
