# Bug 150 — the manual image-generation dialog posts to a route that does not exist

| | |
|---|---|
| **Status** | **OPEN** |
| **Found** | 2026-09-16, while widening the same dialog's option lists for GPT Image 2.5 ([PR #62](https://github.com/foundry-9/quilltap-server/pull/62)) |
| **Fixed** | — |
| **Severity** | **Medium** — the Generate button in the image-upload dialog cannot work at all. Nothing is lost or corrupted; the feature simply never produces an image |
| **Who it bites** | anyone pressing **Generate** in the image dialog reached from the character editor (`CharacterEditView`) or the avatar selector (`avatar-selector.tsx`) |
| **Provenance** | Original to v4. Almost certainly since the v2.8 removal of the legacy non-v1 routes |
| **Defect site** | `components/images/image-generation-dialog.tsx:174` |
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

**The dialog's test suite mocks a third URL.**
`__tests__/unit/image-generation-dialog.test.ts` drives `jest-fetch-mock`
against `/api/images/generate` — the pre-v1 legacy path, removed in v2.8 — and
asserts on the mock's own responses. It never asserts what the component
requests, so the suite is green against a component calling a dead endpoint,
and would stay green whatever path the component used.

The surrounding feature also hides it: the dialog is one of two ways to attach
a character image, the other being plain upload, which works. And the
`generate_image` tool path — how images are actually made in practice — goes
through `executeImageGenerationTool` directly and never touches this route.

## The fix (proposed, not applied)

One string, to the action-dispatch spelling the route actually serves:

```ts
const response = await fetch('/api/v1/images?action=generate', { method: 'POST', … });
```

The request body already matches `generateImageSchema` on that route
(`prompt`, `profileId`, `chatId`, `tags`, `options`), so nothing else changes.

Deliberately **not** applied in PR #62, whose scope is GPT Image 2.5: that PR
touches this file only to widen its quality and size lists, and swapping the
endpoint is an unrelated behaviour change that deserves its own review. Note
that until this is fixed, those widened lists are cosmetic — the dialog cannot
reach a provider either way.

## How to verify

Fix the path, then press **Generate** in the character editor's image dialog
with a valid image profile selected; an image should be produced and attached.

The regression guard worth adding with the fix is a test that asserts the
**requested URL**, since that is the assertion the existing suite lacks:

```ts
expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/images?action=generate');
```
