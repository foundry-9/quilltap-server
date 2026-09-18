# Bug 154 — the star that sets a character's default prompt calls an action nobody serves

**FIXED in v4 (2026-09-18)** — the star now PUTs the prompt's own route, the
default is recorded in one place instead of two that could disagree, and the
badge moves before the round trip.

| | |
|---|---|
| **Status** | **FIXED** |
| **Found** | 2026-09-18, reported from the System Prompts tab of **Edit: Baraka Ilunga** |
| **Fixed** | 2026-09-18 |
| **Severity** | **Medium** — no data loss, but the control does nothing at all, and the second half (the divided default) could make a *successful* change take no effect on the next chat |
| **Who it bites** | anyone with more than one system prompt on a character. The star is the only one-click way to switch defaults; the workaround is the edit dialog's checkbox, which does work |
| **Provenance** | Original to v4. The URL names an action that has never existed in `/api/v1/` |
| **Fix site** | `components/characters/system-prompts-editor/hooks/useSystemPrompts.ts:221`, `lib/database/repositories/characters.repository.ts` (system-prompt writes), `app/api/v1/characters/[id]/handlers/put.ts`, new `lib/characters/default-system-prompt.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

## Symptom

On **Aurora → Edit character → System Prompts**, pressing the star beside a
non-default prompt does nothing. The **Default** badge stays where it was.
No error appears. Opening the same prompt in the edit dialog and ticking
**Set as default prompt** works.

## Root cause

Two defects, one on top of the other.

### The star addressed an action that does not exist

```ts
// useSystemPrompts.ts, handleSetDefault
await fetch(`/api/v1/characters/${characterId}?action=update-prompt&promptId=${promptId}`, {
  method: 'PUT',
  body: JSON.stringify({ isDefault: true }),
})
```

`update-prompt` appears nowhere in the repository but this one line. The
character PUT dispatches exactly one action (`depiction-guidelines`), so the
request fell through to the generic character update — whose
`updateCharacterSchema` is a `z.object`, and strips every key it does not
declare. `isDefault` is not one of them.

The handler therefore updated the character with an **empty patch** and answered
**200**. The client showed *"Default prompt updated"*, refetched, and rendered
the unchanged list. A success path that changes nothing is the worst shape this
can take: nothing to see in the console, nothing in the network tab but a 200.

The edit dialog escaped because it takes the other road — `handleSave` PUTs
`/api/v1/characters/[id]/prompts/[promptId]`, whose schema *does* declare
`isDefault`, and whose repository call demotes the other prompts.

### The default was recorded in two places that could disagree

Underneath, a character's default prompt is stored twice: as the `isDefault`
flag inside the prompt, and as the `defaultSystemPromptId` column on the row.
Every consumer reads **the column first** and falls back to the flag only when
the column is null.

Nothing kept them together. `updateSystemPrompt` moved the flag and left the
column; the Profiles-tab picker (`handleSaveDefaultSystemPrompt`) wrote the
column and left the flag, syncing the flags **in local React state only**. So
even once the star reached a route that works, a character whose column had been
set from the picker would show the new badge and still open new chats with the
old prompt.

Worse, two of the five readers do not fall back at all:

```ts
// useNewChat.ts — a column naming a prompt that no longer exists yields undefined,
// and the chat is seeded with no system prompt whatsoever
const defaultPromptId = char.defaultSystemPromptId
  ? char.systemPrompts?.find((p) => p.id === char.defaultSystemPromptId)?.id
  : char.systemPrompts?.find((p) => p.isDefault)?.id ?? char.systemPrompts?.[0]?.id
```

Five call sites resolved the same question by hand, in three different ways.

## Why it survived

- **The failure is a 200.** The client's only check is `res.ok`, and the
  server's schema drops the offending key silently by design.
- **There is a working twin one click away.** The edit dialog's checkbox does
  the same job through the correct route, so the feature is not obviously
  broken — only the star is.
- **The divided default is invisible until the two halves disagree**, which
  needs the picker and the star to have been used on the same character.
- No test drove `handleSetDefault`, and no test asserted that a system-prompt
  write moves the column.

## The fix

**The star calls the route that exists.** `handleSetDefault` now PUTs
`/api/v1/characters/[id]/prompts/[promptId]` with `{ isDefault: true }` — the
same road the edit dialog already took. It also writes the new default into the
TanStack Query cache before the round trip and rolls back on failure, so the
badge moves on the click rather than a refetch later.

**The two halves move together.** `CharactersRepository.systemPromptsPatch` is
the one patch every system-prompt write now applies: it carries the prompts
array *and* derives `defaultSystemPromptId` from whichever prompt holds the
flag. Add, update, delete and `setDefaultSystemPrompt` all go through it, so
promoting, demoting or deleting a default keeps the column honest. The one
exception is a **brand-new** prompt made default: the id minted at write time is
transient (the vault re-keys a prompt from its file path on the next read), so
the column is left null — which routes readers to the flag, which is correct —
and the next write heals it.

**The picker uses the same chokepoint.** The character PUT handler pulls
`defaultSystemPromptId` out of the generic payload and routes it through
`repos.characters.setDefaultSystemPrompt`, which moves flag and column together
and answers 400 for a prompt the character does not have.

**One resolution order, stated once.** `lib/characters/default-system-prompt.ts`
holds `resolveDefaultSystemPrompt` / `resolveDefaultSystemPromptId`: the column
when it names a prompt that exists, then the flag, then the first prompt. It
replaces the hand-rolled resolution in `lib/chat/initialize.ts`, both seeding
paths in `useNewChat`, `CharacterPickerPanel`, `InsertAnnouncementDialog` and
the impersonation voice preview — including the two that used to seed a chat
with no prompt at all when the column was stale.

Separately, the **Edit Prompt** dialog went from `2xl` to `4xl`. At 2xl its
content box is ~624 px against a ~647 px markdown toolbar, so the right end of
the toolbar ran off the edge of the dialog with nothing to scroll.

## How to verify

1. Give a character two system prompts. Press the star on the non-default one.
   The **Default** badge moves immediately, and survives a reload.
2. `SELECT defaultSystemPromptId FROM characters WHERE id = …` names the prompt
   the badge is on.
3. Set the default from **Details → default system prompt** instead; the star
   and badge in **System Prompts** agree with it.
4. Delete the default prompt; the badge and the column both follow the
   promotion. Delete the last one; the column clears.
5. Open **Edit Prompt** — the whole formatting toolbar is inside the dialog.

Regression tests:
`__tests__/unit/lib/database/repositories/character-default-system-prompt-lockstep.test.ts`
(10 cases over the four write paths),
`__tests__/unit/lib/characters/default-system-prompt.test.ts` (the resolution
order, including the stale-column case),
`__tests__/unit/app/api/v1/characters/[id]/handlers/put.route.test.ts` (four new
cases pinning the handler on the chokepoint).
