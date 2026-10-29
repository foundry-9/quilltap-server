# Bug 250 — a typeahead menu reopened by undo can be left open, orphaned at the top-left, after the composer is cleared

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-15, live on `V4test` during the Lexical 0.52 upgrade smoke test |
| **Fixed** | 2026-10-16 |
| **Severity** | Low. Cosmetic and transient: the menu closes on the next keystroke or editor update, and a Tab or Enter while it shows only closes it (nothing is inserted). Needs an undo that brings a trigger back, then a change that removes it before React commits the reopened menu |
| **Who it bites** | the Salon composer's three `LexicalTypeaheadMenuPlugin` users: `MentionTypeaheadPlugin`, `CharTypeaheadPlugin` (emoji and Unicode) and `SlashCommandPlugin` |
| **Provenance** | Upstream, new in our build with the Lexical 0.43 → 0.52 upgrade. Confirmed absent on 0.43 by reinstalling it and repeating the sequence twice |
| **Fix site** | `components/chat/lexical/typeahead/GuardedTypeaheadMenuPlugin.tsx` (new wrapper; the three plugins render through it) |
| **Defect site** | `node_modules/@lexical/react/src/LexicalTypeaheadMenuPlugin.tsx`, `closeTypeahead`: `if (resolution === null) return;` reads `resolution` from the render that registered the update listener. 0.43's `closeTypeahead` called `setResolution(null)` unconditionally |
| **v5 status** | Not applicable (v5 does not use Lexical) |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-16).** Option 3 below. `GuardedTypeaheadMenuPlugin` wraps
`LexicalTypeaheadMenuPlugin` and counts opens through `onOpen` (called inside the plugin's transition, so
the count commits with the menu). After each open commits it re-runs the consumer's own `triggerFn` on the
text before the caret; if nothing matches, it calls `onClose` and remounts the plugin by bumping its `key`,
which drops the stale resolution. `MentionTypeaheadPlugin`, `CharTypeaheadPlugin` and `SlashCommandPlugin`
render through it. Reproduced in Jest by seeding `hello @ar` and clearing inside one `act()`, so the clear
lands before the transition commits: red before the wrapper, green after
(`MentionTypeaheadPlugin.test.tsx`, "bug 250"). Not reported upstream yet; if Lexical restores the
unconditional `setResolution(null)`, the wrapper becomes a no-op and can be removed.

## Symptom

In the Salon composer: type `@Ri`, pick `Riya` with Tab, press Cmd+Z (the text goes back to `@Ri` and
the mention menu reopens), then at once Cmd+A and Delete. The composer is empty, but the mention
listbox (`#qt-mention-typeahead-listbox`) stays rendered at the top-left of the window (top 3,
left 0), showing either the old candidates or "No such personage in the register". It goes away on
the next keystroke. Pressing Tab while it shows closes it and inserts nothing. Reproduced every time
with the browser tool's near-instant keystrokes; a person typing fast could hit it.

## Root cause

The plugin's update listener opens the menu with `startTransition(() => openTypeahead(...))`, so the
state change is deferred. If the next editor update arrives before React commits it, the listener
still holds the `closeTypeahead` from the render where `resolution` was `null`. In 0.52 that callback
returns early when `resolution === null`, so the close is skipped, and the deferred open then commits
the stale resolution. The anchor element has no valid caret range by then, so the menu is placed at
the origin. 0.43's callback always called `setResolution(null)`; React applied that after the queued
transition update, so the menu ended closed.

The next update runs the listener re-registered with the committed resolution, which closes the menu
normally. That is why the bug is transient.

## Why it survived

The plugin suites drive Lexical commands directly and never interleave a React transition with an
editor update. The upgrade spec flagged typeahead timing (0.52's `SELECTION_CHANGE_COMMAND` move) for
the smoke test, and the smoke test found it.

## Fix

Options considered, in order of preference (3 was taken):

1. Report upstream (restore the unconditional `setResolution(null)` in `closeTypeahead`, keeping the
   `onClose` call conditional) and take the fixed release.
2. Carry a local patch with `patch-package`. The repo has no patching set up today, so this adds
   tooling.
3. A thin wrapper around `LexicalTypeaheadMenuPlugin` that re-checks the trigger after commit and
   closes a menu whose match no longer holds. Every caller would go through it.

## How to verify

Run the sequence above in the Salon composer. After the fix, `.qt-typeahead-menu` is gone once the
composer is cleared, with no keystroke after it.
