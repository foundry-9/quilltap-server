---
url: /settings?tab=chat&section=custom-tools
---

# Custom Tools — Pascal's Table

> **[Open this setting in Quilltap](/settings?tab=chat&section=custom-tools)**

There comes a moment in every story when the outcome ought not to be anybody's decision. Can she pick the lock? Does the detector register anything at all? What, precisely, does one draw from a deck of many things? You could decide. Your characters could decide. But a story in which the interesting questions are settled by whoever is most eager to settle them is not, in the end, a story with much suspense in it.

This is what Pascal the Croupier is for. A **custom tool** is a small contrivance of your own design — a named action, a roll of chance, and a table telling Pascal what each result means. You write it once, as a modest JSON document. Thereafter your characters may reach for it, and so may you, and neither of you gets to argue with the wheel.

**The wheel cannot be argued with.** This is the entire point, so it bears stating plainly: the roll happens on the server, and Pascal announces the outcome himself, in his own message. Your characters do not write that message. A model that would dearly love to have picked the lock will find the lock has not been picked, and will have to go on from there. Regenerating a reply does not spin again — a roll, once fallen, has fallen.

## Where the tools live

Pascal looks for a folder called `Tools` at the top of any document store, and reads every file in it whose name ends in `.tool.json`. One tool per file.

The folder is not made for you and need not exist; if you want one, simply create `Tools/` in a store and put a file in it. The filename itself carries no weight — a tool's identity is the `name` inside it, so `lockpicking.tool.json` may perfectly well contain a tool named `unlock`.

## A first tool

Here is a complete one. Copy it, put it in `Tools/unlock.tool.json` in any store your character can reach, and it is available immediately — there is nothing to restart and no button to press.

> Should you prefer to see every key at once rather than meet them one at a time, there is an annotated specimen at `docs/developer/CUSTOM_TOOL_SPEC.json` that exercises the lot, and a dice-form companion beside it at `docs/developer/CUSTOM_TOOL_SPEC_DICE.json`. Both are valid and may be copied wholesale.

```json
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "unlock",
  "description": "Attempt to pick the lock.",
  "parameters": {
    "bonus": {
      "type": "number",
      "default": 0,
      "description": "Skill bonus added to the roll.",
      "min": 0,
      "max": 10
    }
  },
  "roll": { "min": 0, "max": 1, "offset": { "$param": "bonus" } },
  "outcomes": [
    { "when": { "gt": 0.60 }, "message": "The lock clicks open.",   "state": "success" },
    { "when": { "lt": 0.30 }, "message": "Still locked.",            "state": "failure" },
    { "when": true,           "message": "The lock is giving way…",  "state": "partial"  }
  ]
}
```

That `$schema` line at the top is worth keeping. It is what lets a decent text editor complete the field names for you and complain before Quilltap has to.

### `description` — write it for the story, not for the machinery

This is the single most consequential sentence in the file, because it is how a character decides whether this tool is the thing they want. Write what the tool *does in the fiction*: "Attempt to pick the lock." Do not write what it does arithmetically: "rolls 0–1 against thresholds." Your character is picking a lock; they are not consulting a probability distribution, and describing it as one is a reliable way to get stilted results.

### `parameters` — optional, and always optional in practice

Up to eight, each with a name, a `type` (`number`, `integer`, `string`, or `boolean`), and — required, without exception — a `default`. The default is required so that a character who reaches for the tool without thinking too hard about it still gets a sensible roll rather than an error.

On numeric parameters you may set `min` and `max`. These are not suggestions: a value arriving from anywhere is clamped into that range before it is used for anything. A character feeling optimistic about a `bonus` of 900 will find it has become 10.

### `roll` — two ways to leave it to chance

**A range.** A number drawn evenly between `min` and `max` (0 and 1 if you don't say), then put through a small, fixed transformation:

```
value = raw × multiplier
value = value + offset
if round: value = the nearest whole number
```

That order matters and does not vary. Any of `min`, `max`, `multiplier`, and `offset` may be a plain number or `{ "$param": "bonus" }`, referring to one of your numeric parameters. This is the only indirection the format has — there are no formulas, no expressions, and nothing that gets evaluated. You will find this restriction generous rather than mean: it means a typo is caught when the file loads, not three hours into a scene.

**Dice.** Or simply write dice, as dice are written:

```json
{ "roll": "1d20" }
```

`3d6+2`, `2d10-1`, `d20` — all understood, modifiers and all, rolled by the same dice Quilltap rolls everywhere else. Between 2 and 1000 sides, up to 100 of them. With dice, the value your outcomes test against is the total, modifier included.

If you leave `roll` out altogether, you get a plain number between 0 and 1.

### `outcomes` — an ordered table, first match wins

Each entry has a `when`, a `message`, and a `state`.

`when` is either the word `true` — meaning "anything" — or a small object of comparisons: `gt`, `gte`, `lt`, `lte`, `eq`, `neq`. Several in one object must *all* hold, so a middling band is written:

```json
{ "when": { "gte": 0.30, "lte": 0.60 }, "message": "…", "state": "partial" }
```

There is deliberately no "or". You will not need it: the table is read from the top and the first entry that matches wins, so ordering says everything an "or" would have said, and says it more legibly.

**The last outcome must be `true`.** Quilltap insists, and refuses to load a tool that ends any other way. The reason is that a table with a gap in it is a table that will one day produce a roll matching nothing at all, at the worst possible moment, in front of everybody. Requiring a catch-all at the end makes that impossible rather than merely unlikely. For the same reason, a `true` anywhere *except* the end is refused too — everything below it could never be reached, which is never what anyone meant.

`state` is one of `success`, `partial`, `failure`, or `info`. It tints Pascal's announcement accordingly. You never write any styling yourself.

### Putting things in the message

Four things may be dropped into a `message`:

| | |
|---|---|
| `{{value}}` | the final number, after the transformation |
| `{{roll}}` | the raw number, before it |
| `{{dice}}` | the dice breakdown, e.g. `3d6+2: [4, 2, 6] + 2 = 14` (empty if you're not rolling dice) |
| `{{params.bonus}}` | a parameter, as it was actually used — after defaulting and clamping |

Anything else in braces is left exactly as you typed it.

```json
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "measure_hawking_radiation",
  "description": "Take a Hawking-radiation reading from the detector.",
  "parameters": {
    "baseline": { "type": "number", "default": 0,       "description": "Lowest plausible reading." },
    "ceiling":  { "type": "number", "default": 1000000, "description": "Highest plausible reading." }
  },
  "roll": { "min": { "$param": "baseline" }, "max": { "$param": "ceiling" }, "round": true },
  "outcomes": [
    { "when": true, "message": "The detector reads {{value}} µK.", "state": "info" }
  ]
}
```

And a tool that rolls honest dice:

```json
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "saving_throw",
  "description": "Roll a d20 saving throw against DC 12.",
  "roll": "1d20",
  "outcomes": [
    { "when": { "gte": 12 }, "message": "Saved! ({{dice}})",  "state": "success" },
    { "when": true,          "message": "Failed. ({{dice}})", "state": "failure" }
  ]
}
```

## Which tool wins: the matter of tiers

The same tool name may reasonably exist in several stores, and Quilltap resolves the question by proximity. Nearest to the character wins:

**their own vault → another participant's vault → a group store → a project store → Quilltap General**

So an `unlock` in a character's own vault quietly supersedes the project's `unlock`, for that character only. This is how one gives a locksmith better odds than everybody else without anybody else noticing.

To switch off an inherited tool rather than replace it, define it nearer and mark it `"disabled": true`:

```json
{ "name": "unlock", "description": "Not for this one.", "disabled": true,
  "outcomes": [{ "when": true, "message": "-", "state": "info" }] }
```

The name is then suppressed at that tier and every tier beyond it.

If two stores at the *same* distance both define a name, Quilltap picks one deterministically and notes the fact — but this is a coin-toss you did not intend to write, and is worth tidying up.

## Rolling in secret

Some rolls should not be public knowledge. Set `"defaultVisibility": "whisper"` and Pascal will whisper the outcome to the character who rolled, and to nobody else — the other characters' contexts simply do not contain it. A character may also whisper a single roll by asking privately, and you may tick **Roll privately** in the popup, which hides the outcome from every character at once.

**You always see it.** Whoever the whisper is for, it renders for you. This establishment has one proprietor, and there is nothing to be gained by keeping you in the dark about your own dice.

## On keeping the odds to yourself

Set `"revealOdds": false` and a character is told only the tool's name, its description, and its parameters. The roll spec and the outcome table are withheld — they know they may attempt the lock; they do not know what it takes.

**One honest caveat, which you should read before relying on this.** `revealOdds` hides the odds from the *tool listing*. It does not make the file secret. A `.tool.json` is an ordinary document in an ordinary store, and a character with read access to that store can simply open it and read the odds for themselves, as they could any other document.

If the odds must genuinely be secret, put the file in a store the character cannot read. Quilltap's per-document and per-store permissions already do this properly; `revealOdds` is a courtesy, not a lock.

## Rolling one yourself

When a scene has any custom tools, a button appears in the composer's left-hand gutter. It lists what's available, with a small form for any parameters (already filled in with their defaults), a **Roll privately** tick, and a Run button.

Rolling this way posts two things: a brief note from you saying you ran the tool — so your characters understand it was you who reached for it — and then Pascal's outcome. Should a tool be defined differently for different characters, you'll see each variant listed with the character's name beside it, and running it rolls that character's version.

## When something is wrong with a file

A tool that cannot be loaded is simply left out of the roster, and appears in the popup with a badge explaining why. It is never half-loaded and never guessed at. Common causes: the JSON doesn't parse; the last outcome isn't `true`; a `$param` names a parameter that doesn't exist, or one that isn't a number; the dice notation has a typo; two files in the same store claim the same name.

If a roll fails while it's actually running — a bound that ended up above its own ceiling, say — **Prospero** reports it, not Pascal. Pascal announces outcomes, and only outcomes. A roll that didn't happen doesn't get one.

## Limits

Sixty-four tools per scene, eight parameters and thirty-two outcomes per tool, a thousand characters per message, five hundred per description. If a scene somehow exceeds the roster limit, the surplus is dropped and said so out loud — never silently.

## Turning it off

The **Custom tools** setting on Settings → Chat governs the whole arrangement. Switched off, `run_custom` is never offered to any model and the gutter button goes away. Your files stay exactly where they are.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this setting:

`help_navigate(url: "/settings?tab=chat&section=custom-tools")`

## Related Settings

- **Settings → Chat → Automation** — auto-detection of dice rolls (`2d6`, `3d6+2`) written plainly in a message.
- **The Scriptorium** — the document stores your `Tools/` folders live in.
