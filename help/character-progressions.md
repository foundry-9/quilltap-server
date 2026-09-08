---
url: /aurora/:id/edit
---

# Progressions — Things That Take Time

> **[Open this page in Quilltap](/aurora)**

Some facts about a character are not settled; they are *underway*. A
pregnancy that began on the first of August and is due the first of May. A
ship's cannon that wants ten minutes on the coils before it will speak again.
A curse that lifts at the next full moon. A cask of something ill-advised
that finishes fermenting in three weeks.

Until now the only way to keep a model apprised of such a thing was to
mention it yourself, every time, and hope. Models are poor at elapsed-time
arithmetic and very much poorer at *remembering that time has passed at all*.
Ask one how far along a gestation is and you will get a confident number
arrived at by no process whatever.

A **progression** settles the matter. It is a named span of time your
character is carrying — a beginning, an ending, and a note of how often they
ought to be reminded. Every turn they take, Quilltap does the arithmetic
itself and tells them where things stand, in plain second person, before they
open their mouth.

> *Pregnancy: You are carrying a child. You are 20 weeks along; due in 18
> weeks, 4 days.*
>
> *Cannon recharge: 2 minutes, 10 seconds elapsed, 7 minutes, 50 seconds
> remaining, 22% complete (0.2/1.0 MJ).*

Nobody guessed at either of those numbers. They were counted.

## Where To Find Them

The **Progressions** card lives on the **System Prompts** tab of a
character's edit page, below their subprompts — the company it keeps is the
other things a character *carries* into a room rather than the prose that
describes them.

Each entry shows its name, the identifier a tool would address it by, a pill
saying whether it has begun, and the exact line your character will read,
ticking along in front of you. What you see on the card is what they see in
the prompt; there is no second rendering to be surprised by.

## Composing One

**Add Progression** opens the editor.

**Name.** How it is announced. *Cannon recharge*, *Pregnancy*, *The Vittoria's
starboard boiler*. Change it whenever you like.

**Identifier.** A short, typeable token — `cannon`, `pregnancy` — coined from
the name when you create the entry and immovable thereafter. This is the
handle a custom tool reaches for, and a tool written before the character
existed cannot be expected to keep up with a change of mind about the name.
That is precisely why the two are separate.

**Description.** One sentence, in the second person, in your own words:
*You are carrying a child.* It is set before the default wording as its own
sentence, so the character is told plainly what the numbers are about.

**Begins** and **Ends.** Wall-clock instants, entered in your own timezone.
The shortcut buttons underneath — *+10 minutes*, *+9 months* — set the ending
relative to the beginning, since nobody enjoys counting to May.

**Spoken in.** The unit the report *talks in*: weeks for a gestation, minutes
for a recharge. It changes only the phrasing, never the arithmetic. Spans
render as whole units of your chosen unit plus a remainder in the next finer
one — *20 weeks, 3 days*; *2 minutes, 10 seconds*.

**Mentioned.** How often the report appears. See below; it is the field worth
understanding.

**Percentage**, **amount**, and **how it's told.** Cosmetics, mostly, and
described further down.

**Once it finishes.** Whether the completed state keeps being reported, or is
announced exactly once and then goes politely quiet.

## Cadence — How Often To Say So

A recharging cannon wants mentioning every single turn: the whole drama is in
the seconds. A pregnancy mentioned every turn is a tedious pregnancy. So each
entry chooses for itself:

| Setting | What it means |
|---|---|
| **Every turn** | Said each time the character is prompted. Right for anything measured in seconds or minutes. |
| **When the unit changes** | Said only when the whole count of the chosen unit ticks over — week 20 becoming week 21. Right for anything slow. |
| **At most once every *n*** | Said at most once per clock hour, day, or whatever you name. Right for a middle case: present, but not underfoot. |

Two things override all three. A progression you have just **edited** is
reported on the character's very next turn regardless — you changed
something, and they should know. So is one a **custom tool** has just
adjusted: a cannon that has this instant been re-armed announces itself
immediately rather than waiting politely for the next hour to come round. And
a progression that **crosses one of its own boundaries** — begins, or
finishes — always says so on the turn it happens.

### The one small imprecision

Cadence is worked out from the character's own last turn in that room, which
is what lets the whole feature run without writing anything to disk on every
turn. There is one consequence worth knowing: a character who is *prompted
but says nothing* — a "nothing to add" pass — leaves no new turn behind, so
an hourly progression may be mentioned once more inside the same hour on
their next prompt.

Over-reporting by at most one line, occasionally. That is the honest price of
never writing to the database in the middle of composing a turn, and we
thought it the better bargain.

## Months And Years Are Averages

Quilltap counts a month as 30.436875 days and a year as 365.2425 days — the
mean lengths, not the calendar's own irregular ones. The arithmetic is then
perfectly deterministic and wants no calendar at hand.

In practice you will never notice, save in one place: a progression that
began on the 31st does not tick over on the 31st. "Eight months along" does
not require calendar months to be a true and useful sentence, and it is
rather more useful for being arrived at the same way every time.

## Amounts

If your span *fills* something — a capacitor to one megajoule, a vat to two
hundred litres, a magazine to thirty rounds — tick **It fills a measurable
amount** and say what and how much. The report then carries the level
alongside the percentage: *(0.2/1.0 MJ)*. The current amount is worked out
from how far along the span is; you never store it, and it can never drift
out of step with the clock.

## How It's Told

Leave the template blank and the wording composes itself from what you have
already set — the description, the elapsed and remaining spans, the
percentage if you asked for it, the amount if there is one.

Fill it in and you have the sentence yourself:

```
{{description}} You are {{elapsedWhole}} along; due in {{remaining}}.
```

The pieces you may set into it:

| Placeholder | What appears |
|---|---|
| `{{name}}` | the progression's name |
| `{{description}}` | your sentence, or nothing at all |
| `{{elapsed}}` | *20 weeks, 3 days* |
| `{{elapsedWhole}}` | *20 weeks* |
| `{{remaining}}` | the same, counting down |
| `{{remainingWhole}}` | whole units only |
| `{{percent}}` | a whole number, 0 to 100 |
| `{{quantity}}` | *0.3/1.0 MJ*, or nothing |
| `{{start}}` / `{{end}}` | the wall-clock date, with a time of day when the unit is finer than a day |
| `{{increment}}` | the unit word — *week* |

Write a placeholder we do not recognise and it is left standing in the
sentence exactly as typed, which is a good deal kinder than opening a hole
where a word should be: you can see at once which name you got wrong.

Your wording covers the stretch while the thing is *running*. Before it
starts and after it finishes, the report says so in its own brief words — *begins
in 3 days*, *complete; 3 days since it finished* — which no template
overrides, those two states being structurally different sentences.

## What Pascal Can Do With Them

Progressions live inside your character's `metadata.json`, which is precisely
the drawer [Pascal's custom tools](custom-tools.md) already have the key to.
A tool may therefore:

- **Ask after one.** `progress.cannon.complete`, `progress.cannon.percent`,
  `progress.cannon.remainingMs`, and the rest.
- **Be withheld until one finishes.** A `fire_cannon` tool gated on
  `progress.cannon.complete` simply does not appear on the roster while the
  gun is charging. The model is never told a withheld tool exists, so it
  cannot be wheedled into firing early.
- **Re-arm one.** On a successful roll, a tool may write a fresh beginning
  and ending — `{{now}}` and `{{now}} + 600000` — and the character is told
  about it on their very next turn.
- **Create one nobody wrote.** A tool writing to an identifier no progression
  answers to conjures a new one, sensibly furnished.
- **Remove one**, when the curse is lifted and the countdown is moot.

The full grammar is in [Custom Tools](custom-tools.md) and
[Pascal's Workbench](pascals-workbench.md).

## What The Model Cannot Do

**It cannot set its own due date.** No tool exists for the model to call. It
cannot start a progression, move an ending, or declare one complete. Only you
— through this editor or the vault file — and Pascal's server-side rolls may
touch them.

This is deliberate and it is the entire point. A model permitted to adjust
its own countdown will adjust its own countdown, and the deterministic clock
you installed to stop it guessing becomes one more thing it is guessing at.

The one caveat, and it is the same caveat that has always applied: a
character with **system transparency** may read and write files in their own
vault through the ordinary document tools, and `metadata.json` is a file in
their own vault. If that troubles you, do not grant transparency to a
character carrying a progression that matters.

## Hand-Editing The File

Progressions occupy one reserved key, `progressions`, inside the character
vault's `metadata.json`. Every other key in that file remains entirely yours
and is never validated; this one alone has a shape.

```json
{
  "faction": "Ordo Aurum",
  "progressions": {
    "cannon": {
      "name": "Cannon recharge",
      "startTime": "2026-09-08T14:02:10Z",
      "endTime": "2026-09-08T14:12:10Z",
      "timeIncrement": "minute",
      "percentageReport": true,
      "reportFrequency": "turn",
      "quantity": { "total": 1.0, "unit": "MJ", "precision": 1 },
      "onComplete": "once"
    }
  }
}
```

Point your editor at
[`/schemas/qtap-progression.schema.json`](/schemas/qtap-progression.schema.json)
and it will keep you honest about the shape.

Two courtesies if you edit by hand. Timestamps want a zone — `Z` or an offset
— because a reading without one is not an instant and we decline to guess at
one. And an entry edited by hand carries no `updatedAt`, so the change waits
politely for the cadence rather than being announced on the next turn; add
one yourself if you want it heard immediately.

An entry we cannot read is **dropped, alone**. The rest of the character's
progressions carry on, the character carries on, and the card says which
entry is being skipped. A single mistyped date has never yet been worth
losing a character over.

## Related Topics

- [Editing Characters](character-editing.md) — the rest of the edit page
- [Custom Tools](custom-tools.md) — reading and adjusting progressions from a tool
- [Pascal's Workbench](pascals-workbench.md) — writing those tools
- [Shared Character Vaults](shared-character-vaults.md) — where `metadata.json` lives

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora/:id/edit")`
