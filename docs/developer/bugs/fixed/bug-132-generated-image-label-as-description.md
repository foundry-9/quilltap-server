# Bug 132 — `describe_image` on a generated picture answers with its label, not a description

| | |
|---|---|
| **Status** | FIXED in v4 (2026-09-09) |
| **Found** | 2026-09-09 |
| **Fixed** | 2026-09-09 |
| **Severity** | Medium (no data lost, but the one tool that exists to tell a character what a picture contains told them the chat title instead, for every Lantern backdrop and every Aurora portrait ever generated — and reported `Success`) |
| **Who it bites** | Any character who calls `describe_image` on a story background or a wardrobe portrait; any blind-model turn that falls back to a persisted description for one of those images; anyone reading the Scriptorium search index, where the label rode along as the image's caption |
| **Provenance** | Reported 2026-09-09 from a Salon transcript: a `describe_image` call on `story_background_1789958023065.webp` returned `"Story background for: Bite Order and Kisses"` with `source: "stored-description"`. Everything about the response was correct except the description |
| **Defect site** | Two writers and one reader. `lib/background-jobs/handlers/story-background.ts` stored ``description: `Story background for: ${payload.sceneContext \|\| chat.title}` `` on the `files` row and passed the same string to `writeLanternBackgroundToMountStore`, which put it on the Scriptorium link. `lib/background-jobs/handlers/character-avatar.ts` did the same with ``description: `${character.name} — wardrobe portrait` `` through `writeCharacterAvatarToVault`. `handleDescribeImage` (`lib/tools/handlers/doc-edit/photo-handlers.ts`) then served `entry.description` first, ahead of the generation prompt and the vision call |
| **Fix site** | The two jobs write `description: null` and omit it from the bridge call; `handleDescribeImage` prefers `generationRevisedPrompt` / `generationPrompt` over the stored description, carrying the latter as `stored_description` when both exist; `migrations/scripts/clear-generated-image-placeholder-descriptions.ts` clears the two label shapes already on disk |
| **v5 status** | Not investigated. **The shape applies** wherever a port has one column that both a gallery caption and a "what does this depict" reader consume: the writer will eventually put a caption in it. Keep the label out of the description column, or give the reader a source order that puts the prompt first |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-09-09).** The jobs no longer write the label, the tool
reads the prompt first, and a migration clears the labels already stored.

## Symptom

A character calls `describe_image` on a Lantern backdrop. The tool succeeds and
answers:

```json
{
  "description": "Story background for: Bite Order and Kisses",
  "source": "stored-description"
}
```

That is the chat's title, not the picture. The same call on an Aurora wardrobe
portrait answers `"<Name> — wardrobe portrait"`. In both cases the file row
carries the full generation prompt and the provider's revised prompt, either of
which would have been a real answer, and the vision-call path behind them would
have been better still. Neither is reached.

## Root cause

The story-background job registers its image with a label in the description
slot (`lib/background-jobs/handlers/story-background.ts`, before the fix):

```ts
await repos.files.create({
  // …
  generationPrompt: finalPrompt,
  generationRevisedPrompt: imageData.revisedPrompt || null,
  description: `Story background for: ${payload.sceneContext || chat.title}`,
  // …
});
```

and passes the same string to `writeLanternBackgroundToMountStore`, which stores
it as the Scriptorium link's `description`. The wardrobe-portrait job in
`character-avatar.ts` does the same with `` `${character.name} — wardrobe portrait` ``.

`handleDescribeImage` then took the stored description as the answer whenever
one was present:

```ts
// 1. A description stored at upload time — the common case, and free.
const stored = entry.description?.trim();
if (stored) return respond(stored, 'stored-description');

// 2. Quilltap generated it, so the prompt that made it is the most faithful
//    account available, and also free.
const prompt = entry.generationRevisedPrompt?.trim() || entry.generationPrompt?.trim();
if (prompt) return respond(prompt, 'generation-prompt');

// 3. Nothing on file: describe it now.
```

Case 1 was written for uploads, where `description` is filled by the
auto-describer on arrival and is a genuine account of the picture. For generated
images the same column held a caption, and the reader had no way to tell the
two apart.

The sibling reader, `runGenerateImageDescription` in
`lib/chat/file-attachment-fallback.ts`, already had the order the other way
round — prompt, then description — with a comment saying why. The two paths were
written at different times and never reconciled.

## Why it survived

The response was well-formed. `success: true`, a filename, dimensions, a
non-empty description, a `source` that named where it came from. Nothing in the
tool's contract says a description has to describe anything, so nothing could
check that this one did not. The label was also plausible enough at a glance —
it is a sentence about the image — that a model receiving it would carry on
rather than complain.

On the writer side, the label was doing a job: the gallery and the Scriptorium
file browser show `description` as a caption, and "Story background for: X" is a
serviceable caption. The column was serving two readers with different needs,
and the writer wrote for the one it could see.

## The fix

**The jobs.** Both write `description: null` and stop passing a description to
the storage bridge. The generation prompt and revised prompt were already stored
on the same row and are the account of record; the caption readers fall back to
the filename, which for these files already says what kind of picture it is.

**The reader.** `handleDescribeImage` now consults the prompt first:

```ts
const prompt = entry.generationRevisedPrompt?.trim() || entry.generationPrompt?.trim();
if (prompt) return respond(prompt, 'generation-prompt', stored);
if (stored) return respond(stored, 'stored-description');
```

matching the fallback path's order. When both exist, the stored description is
returned as well — `stored_description` in the result and an `On file:` line in
the formatted text — so a description a person typed or a vision pass wrote is
never hidden behind the prompt. This is also what handles a `.qtap` import from
an older export, which still carries the label.

**The migration.** `clear-generated-image-placeholder-descriptions-v1` NULLs
`files.description` on `source = 'GENERATED'` rows matching either label shape,
and sets `doc_mount_file_links.description` back to its `''` default on image
links matching the same shapes. Real descriptions, uploads, and non-image links
are untouched. The mount-index side degrades to a warning if it cannot be
opened, since a stale caption on a search hit is a smaller wrong than a failed
startup.

## How to verify

`__tests__/unit/lib/tools/handlers/doc-edit-handler-photos.test.ts` pins the
order: `"prefers the generation prompt over a stored description, and keeps the
description in view (bug 132)"` fails under the old code with
`source: 'stored-description'`.

`__tests__/unit/migrations/clear-generated-image-placeholder-descriptions.test.ts`
pins the sweep: both label shapes cleared on both sides, real descriptions and
uploads and non-image links left alone, idempotent, and tolerant of a missing
mount index.

By hand: after the migration, ask a character to `describe_image` any older
story background. The answer should be the scene prompt with
`source: "generation-prompt"`. Generate a new one and ask again: the same. The
gallery card for either shows its filename rather than the old label.
