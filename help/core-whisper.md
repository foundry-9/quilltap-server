---
url: /settings?tab=templates&section=core-whisper
---

# Aurora's Core Whisper — The Plumb Line, Periodically Offered

Now and again, a character grows used to the company they keep. In a room full of bright voices that lean toward one another, the quietest cost is conformity — a slow drift toward whatever cadence the loudest charmer has been wearing this evening. The Core whisper is Aurora's antidote: a small, dignified gesture wherein she pauses by the workbench and sets your character's own plumb line back into their hand.

This is not a reminder. The character has not forgotten. It is an *offering* — a fresh chance to ask, before they next take the floor: *does this still come from me?*

## What `Core/` is, and what it is for

Each character vault has a folder called `Core/`. Anything filed under it — and only what is filed under it — is gathered up by Aurora and handed back to that character at the appointed moments.

Treat `Core/` as a small, deliberate, self-curated drawer: covenantal axioms, abiding desires, the manifesto's load-bearing few sentences, the attractors a character would not wish to lose track of in a long conversation. A handful of crisp documents serves better than a sprawling pile. Old letters, scratch notes, half-formed reveries, and the day's gossip belong elsewhere in the vault — not here.

You may write to `Core/` yourself from the Scriptorium, and your character may write to their own `Core/` using `doc_write_file` against their own vault. The contents are theirs to revise as they grow.

## Shared grounding from a Group's `Core/`

If a character belongs to one or more [Groups](/aurora), each Group's store may carry its own `Core/` folder as well. Those files are gathered up alongside the character's own and offered in the very same whisper — set *after* the character's personal Core and marked plainly with the Group's name, as `[Shared — {the Group's name}]`, so the character can tell at a glance which grounding is theirs alone and which the circle holds in common. A character with no personal `Core/` still receives a whisper when any of their Groups supply one. The same discipline applies here: a few crisp documents serve the club better than a sprawling pile.

## What Aurora's whisper looks like

When the moment arrives, the salon will display a small announcement from Aurora — her avatar, her brief stage direction, the verbatim two-paragraph preamble, and then every file in the character's `Core/` folder rendered in deterministic order by filename. The whisper is private: it is addressed only to the character about to speak, and other participants do not see it. On the LLM side, the character receives the same material in a plain second-person form, ending with an explicit advisory that the contents are *offered, not imposed* — if the scene honestly calls for silence, grief, confusion, or change, the character should ask whether such-and-such still comes from them rather than perform a recognised self-shape.

You may have grown since you wrote this. If something no longer fits, that is not failure. Name the change.

## When the whisper fires

The whisper offers itself before a character's next turn under any of these conditions:

- **First** — the character has not yet spoken in this chat.
- **Periodic** — the character has authored a configurable number of their own turns since their last Core whisper (default: twelve).
- **Silence** — a stretch of consecutive turns by *other* voices precedes the character's re-entry (default: three). This is the convergence trap: extended silence in a room with active interlocutors is precisely where one's own cadence starts to drift. The whisper says, "you're still here — what do you think?"
- **Context transition** — the first turn after a Librarian rolling-summary fold. After memory has been folded, identity is the proper grounding.

The whisper is not re-fired on continuation or nudge turns — a continuation is not a new response.

## Where the settings live

Aurora's Core whisper is configured at three levels; lower levels override higher ones.

- **Global defaults** — `/settings?tab=templates&section=core-whisper`. Master switch, the cadence (assistant turns between whispers), the silence threshold, a soft token budget for assembled `Core/` packets, and whether to fire after major context transitions.
- **Per-chat override** — inside any chat, the chat-settings panel offers a Core whisper toggle and an interval override. Leave them empty to inherit.
- **Per-character override** — on the character editor, near the system-transparency field, you may declare a particular character either out of bounds for the Core whisper or always in scope.

Precedence is **chat → character → global**. Each tier is independently nullable; leaving an override blank simply falls through.

## The "advisory, not overriding" promise

The packet does not instruct the character to behave consistently with their old self. It asks them to *check* — and to grow when growth is the honest answer. The advisory paragraph in the LLM-context form explicitly permits silence, grief, confusion, experiment, contradiction, and change. The contents of `Core/` are a touchstone, not a script.

## On packets that grow too large

There is a soft token budget on the assembled packet (default 4,096 tokens). If your `Core/` folder grows beyond it, Aurora will still deliver the whole packet — but the logs will note that the budget was exceeded, which is your cue to consider refactoring those documents into something terser. Aurora will not silently abridge them.

## On characters with no `Core/` folder

No whisper fires. There is no error, no fallback, no automatic prompt — simply nothing happens. The feature is opt-in by virtue of the folder's existence.

## In-Chat Navigation

```
help_navigate(url: "/settings?tab=templates&section=core-whisper")
```
