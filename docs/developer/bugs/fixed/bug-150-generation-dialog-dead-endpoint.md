# Bug 150 — the manual image-generation dialog posts to a route that does not exist

**FIXED in v4 (2026-09-16)** — the fetch call now posts to the action-dispatch
route the server actually serves, and a new test renders the real component
to assert on the requested URL, closing the gap that let this ship.

| | |
|---|---|
| **Status** | **FIXED** |
| **Found** | 2026-09-16, while widening the same dialog's option lists for GPT Image 2.5 ([PR #62](https://github.com/foundry-9/quilltap-server/pull/62)) |
| **Fixed** | 2026-09-16 |
| **Severity** | **Medium** — the Generate button in the image-upload dialog cannot work at all. Nothing is lost or corrupted; the feature simply never produces an image |
| **Who it bites** | anyone pressing **Generate** in the image dialog reached from the character editor (`CharacterEditView`) or the avatar selector (`avatar-selector.tsx`) |
| **Provenance** | Original to v4. Almost certainly since the v2.8 removal of the legacy non-v1 routes |
| **Fix site** | `components/images/image-generation-dialog.tsx:174` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

## Symptom

`ImageGenerationDialog` submits, and the request fails. No image is generated.

## Root cause

The component posts to a path that no route serves:

```ts
const response = await fetch('/api/v1/images/generate', { method: 'POST', … });
```

The generate action lives on the **collection** route under the action-dispatch
pattern — `POST /api/v1/images?action=generate`
(`app/api/v1/images/route.ts:176`). There is no `app/api/v1/images/generate/`
directory, so `/api/v1/images/generate` resolves to the **item** route,
`app/api/v1/images/[id]/route.ts`, with `id = "generate"`. That handler looks
the id up as a file (`repos.files.findById('generate')` → `notFound('Image')`),
and in any case accepts only `add-tag` and `remove-tag`.

So every press of Generate is a 404 against an image that does not exist.

## Why it survived

**The dialog's test suite mocked a third URL.**
`__tests__/unit/image-generation-dialog.test.ts` drove `jest-fetch-mock`
against `/api/images/generate` — the pre-v1 legacy path, removed in v2.8 — and
asserted on the mock's own responses. It never asserted what the component
requests, so the suite was green against a component calling a dead endpoint,
and would have stayed green whatever path the component used.

The surrounding feature also hid it: the dialog is one of two ways to attach
a character image, the other being plain upload, which works. And the
`generate_image` tool path — how images are actually made in practice — goes
through `executeImageGenerationTool` directly and never touches this route.

## The fix

One string, to the action-dispatch spelling the route actually serves:

```ts
const response = await fetch('/api/v1/images?action=generate', { method: 'POST', … });
```

The request body already matches `generateImageSchema` on that route
(`prompt`, `profileId`, `chatId`, `tags`, `options`), so nothing else changed.

Not applied in PR #62, whose scope was GPT Image 2.5: that PR touched this
file only to widen its quality and size lists, and swapping the endpoint was
an unrelated behaviour change deserving its own review.

The test suite (renamed `.test.ts` → `.test.tsx`) gained a new test that
renders the real `ImageGenerationDialog`, fills in a prompt, submits, and
asserts the second `fetch` call's URL is `/api/v1/images?action=generate` —
the assertion the original suite lacked. The rest of the pre-existing suite,
which calls `fetch()` directly against hardcoded strings rather than exercising
the component, was left as-is; it doesn't guard against this class of bug but
isn't wrong on its own terms.

## How to verify

Press **Generate** in the character editor's image dialog with a valid image
profile selected; an image is produced and attached.

```bash
npx jest __tests__/unit/image-generation-dialog.test.tsx
```
