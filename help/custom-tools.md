---
url: /settings?tab=chat&section=custom-tools
---

# Custom Tools — Pascal's Table

> **[Open this setting in Quilltap](/settings?tab=chat&section=custom-tools)**

There comes a moment in every story when the outcome ought not to be anybody's decision. Can she pick the lock? Does the detector register anything at all? What, precisely, does one draw from a deck of many things? You could decide. Your characters could decide. But a story in which the interesting questions are settled by whoever is most eager to settle them is not, in the end, a story with much suspense in it.

This is what Pascal the Croupier is for. A **custom tool** is a small contrivance of your own design — a named action, a roll of chance, and a table telling Pascal what each result means. You write it once, as a modest JSON document. Thereafter your characters may reach for it, and so may you, and neither of you gets to argue with the wheel.

**The wheel cannot be argued with.** This is the entire point, so it bears stating plainly: the roll happens on the server, and Pascal announces the outcome himself, in his own message. Your characters do not write that message. A model that would dearly love to have picked the lock will find the lock has not been picked, and will have to go on from there. Regenerating a reply does not spin again — a roll, once fallen, has fallen.

## Pascal's Workbench

You need not write the JSON by hand at all. **[Pascal's Workbench](pascals-workbench.md)** (`/custom-tools`) is a visual editor for everything on this page: a library of every definition in every store, a form that cannot produce an invalid file, a proving bench for dry-run rolls and a ten-thousand-hand audit, and a repair mode for files that would not read. The hand-format below remains fully supported — the Workbench is sugar, and its live JSON preview is a fine way to learn the format.

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

### `title` — what the thing is called in polite company

The `name` is the tool's identity: lowercase, no spaces, and the string your characters actually call. It is not, however, a thing anyone wants to read. Add a `title` and Pascal will announce that instead:

```json
{ "name": "scan_hawking_radiation", "title": "Scan Hawking Radiation" }
```

Omit it and Quilltap derives one from the name — underscores and hyphens become spaces, and each word is given its capital — which for the example above produces precisely the same string, and for a great many tools will do perfectly well. Write a `title` when the derivation isn't what you'd have said yourself: `saving_throw` might be *Save vs. the House*.

Your characters never see the title. They know the tool as `unlock` and ask for it by that name, which spares them the confusion of a thing with two names and spares you a model that guesses wrong about which one to use.

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

That order matters and does not vary. Any of `min`, `max`, `multiplier`, and `offset` may be a plain number, a `{ "$param": "bonus" }` referring to one of your numeric parameters, or a `{ "$state": "path", "fallback": 0 }` drawing on persistent state (of which more below). In rolls and tests these two references are the *only* indirection — no formulas, no expressions, nothing that gets evaluated. (The one place the format keeps a small arithmetic grammar is a side effect's `value`, of which more below.) You will find this restriction generous rather than mean: it means a typo is caught when the file loads, not three hours into a scene.

**Dice.** Or simply write dice, as dice are written:

```json
{ "roll": "1d20" }
```

`3d6+2`, `2d10-1`, `d20` — all understood, modifiers and all, rolled by the same dice Quilltap rolls everywhere else. Between 2 and 1000 sides, up to 100 of them. With dice, the value your outcomes test against is the total, modifier included.

If you leave `roll` out altogether, you get a plain number between 0 and 1.

### `outcomes` — an ordered table, first match wins

Each entry has a `when`, a `message`, and a `state`.

`when` is either the word `true` — meaning "anything" — or a small object of comparisons: `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, and — for text — `contains` and `ncontains`. Several in one object must *all* hold, so a middling band is written:

```json
{ "when": { "gte": 0.30, "lte": 0.60 }, "message": "…", "state": "partial" }
```

Most of the time you will not need an "or": the table is read from the top and the first entry that matches wins, so ordering says most of what an "or" would have said, and says it legibly. For the rest — one outcome reached by two quite different roads — write the `when` as a **list** of such objects, and the row wins if *any one of them* holds:

```json
{ "when": [ { "gte": 0.90 }, { "inventory": { "lucky charm": { "eq": "equipped" } } } ],
  "message": "Fortune smiles, whether by the dice or by the charm.", "state": "success" }
```

Inside each object the tests still AND together, so **AND binds tighter than OR**: `[ {A, B}, {A, C} ]` reads *"A and B, or A and C"*. There is one level of it only — no lists within lists, no parentheses, and at most eight objects to a list. An author who means *"(B or C) and A"* writes it as `[ {A, B}, {A, C} ]`, which says the same and is a good deal easier on the eye at three in the morning.

#### Asking about more than the number

Written bare like that, the comparisons are about the rolled value. Four other things may be asked about in the same breath, and everything you name must hold:

| | |
|---|---|
| bare `gt`, `gte`, … | the final value, after the transformation |
| `roll` | the raw number, *before* it |
| `params` | what the tool was actually called with, by parameter name |
| `metadata` | what the *character doing the rolling* carries on their fact sheet |
| `progress` | how far along one of that character's timed **progressions** is |
| `inventory`, `inventoryCount`, `inventoryAggregate` | what that character carries — one object, or everything at once (below) |
| `llm` | what the consulted oracle answered, if the tool keeps one — see below |

So *"the value exceeded 1, and the scale was set past 12"* is written:

```json
{ "when": { "gt": 1, "params": { "scale": { "gt": 12 } } }, "message": "…", "state": "success" }
```

`roll` earns its keep when a multiplier or an offset has carried the value some distance from what the dice actually did — a raw draw in the bottom fiftieth is a fumble whatever you have since multiplied it by, and only `roll` can say so.

`params` will compare numbers with any of the ordering four, and will compare a string or a boolean with `eq` and `neq` — `{ "params": { "material": { "eq": "brass" } } }` is a perfectly good question. It will not pretend to *order* a string: asking whether `"brass"` is greater than 1 is refused when the file loads rather than quietly never happening.

For text, equality is often too blunt an instrument, and so there is `contains` — and its opposite number, `ncontains` — which ask whether a string *holds* a substring rather than whether it *is* one. `{ "params": { "cargo": { "contains": "opium" } } }` matches a manifest of `"silk, opium, brandy"` without requiring the whole inventory verbatim. The substring must be actual text: something to look for (an empty one is refused when the file loads, on the grounds that everything contains nothing), and pointing it at a number parameter is refused the same way. On `params` and `metadata` the search is exact and case-minded, like `eq` there; the oracle's answer is treated more forgivingly, as you will see below.

A comparison may also be made against a parameter instead of a number you fixed in advance, by writing `{ "$param": "difficulty" }` where the number would go. This is the opposed check, and it is written thus:

```json
{ "when": { "gte": { "$param": "difficulty" } }, "message": "Beaten, by exactly enough.", "state": "success" }
```

The same trick serves a substring: `{ "contains": { "$param": "searchTerm" } }` looks for whatever text the caller supplied, so one input may be sought inside another — or, as below, inside an oracle's answer.

Still no formulas, still nothing evaluated — only comparisons that must all hold, and at most a list of such bundles, any one of which will do. It is a smaller box than you might like for about a week, and a considerable comfort thereafter.

#### Asking what the character is carrying

`metadata` asks about the roller's **fact sheet** — the `metadata.json` file at the root of their character vault, holding whatever keys you troubled to write there. (See *[Editing Characters](character-editing.md)* for the file itself.) It is how one table deals differently to different people:

```json
{ "when": { "gt": 0.60, "metadata": { "hasAnsibleAccess": { "eq": true } } },
  "message": "The ansible flickers to life.", "state": "success" }
```

The same comparisons, ANDed the same way — `contains` and `ncontains` included, when the key holds text — and `{ "$param": "…" }` operands work here too — `{ "metadata": { "clearanceLevel": { "gte": { "$param": "required" } } } }` weighs what the character *has* against what the caller *asked for*, which is a great deal of drama for one line of JSON.

**And now the important part: a character who hasn't got the key.** Suppose Bertie, who has never in his life heard of an ansible, reaches for that tool. The `hasAnsibleAccess` test simply does not match — no error, no complaint, no bubble in the transcript. The row is passed over, the table reads on, and Bertie lands wherever your catch-all sends him. This is not Quilltap being lenient; it is the only sensible reading. Metadata keys are yours to invent, per character, and no file could possibly know which characters have which. A table branching on a key **must** still deal to whoever lacks it, and the `true` at the bottom of your table is precisely where you say what that means.

The same quiet non-match covers every way a sheet can decline to answer:

- **The key isn't there at all.** Including under `neq` — absence is not inequality, and `{ "faction": { "neq": "Ordo Ferrum" } }` will not match a character who has no `faction` whatsoever. `ncontains` follows the same rule: a character with no `faction` does not thereby *lack the substring* — they lack the sheet entry, which is a different thing. If you want "hasn't got it" to be *interesting*, put it in the catch-all, or order a row above it that tests something they do have.
- **The key holds a list — which is compared entry by entry.** `knownLanguages: ["Trade Cant", "Latin"]` is a perfectly good thing to keep on a sheet, and `{ "eq": "Latin" }` matches it: `eq` holds when *any* entry equals what you named, `neq` when *none* does, `contains` when any entry contains the text, `ncontains` when none does. Exact and case-minded, as ever — `"latin"` is not `"Latin"`. What a list will not do is be *ordered*: there is no sensible way to ask whether a list is greater than 3, so `gt` and its relations decline. An empty list is a fact rather than an absence: `neq` and `ncontains` hold against it, `eq` and `contains` do not.
- **The key holds an object, or a list with anything but plain values in it.** `dossier: { "rank": "adept" }`, or a list with an object tucked inside, has no entries Pascal can compare, and no comparison against it matches.
- **The key holds the wrong sort of thing.** Ordering a string (`{ "faction": { "gt": 1 } }`) doesn't match; nor does comparing a number against a string. Note the contrast with `params`, where the very same mistake is refused when the file loads: there, the tool declares its own parameters, so the types are knowable and a nonsense comparison is certainly a typo. Here the file has never met the character, so it cannot be told apart from a perfectly deliberate test of a key that some characters keep as a number and others don't keep at all.
- **`null` cannot be tested.** There is no way to write `{ "eq": null }`, and that is deliberate: an empty key and an absent one both simply fail to match, which spares you having to decide which of the two you meant.

One consequence worth stating plainly: because a row only wins when its metadata tests *held*, a metadata branch is silent in the failure direction. It cannot tell you *why* a character fell through. If a table isn't behaving, check the sheet, not the tool.

#### Asking what the character has on them — `inventory`

Where `metadata` asks what a character *is*, `inventory` asks what they *have* — the objects in [the Inventory](inventory.md) they carry or can reach in this very chat. It is keyed by the object, named by its id, its title or its name, without regard to case, and it asks one question: which of four states the object is in for the roller.

| State | Meaning |
|---|---|
| `equipped` | on their person in this chat |
| `carried` | in their own vault, but not equipped here |
| `reachable` | on a shared shelf — a group's, the project's, Quilltap General — and not equipped |
| `absent` | nowhere within their reach |

```json
{ "when": { "inventory": { "crowbar": { "eq": "equipped" } } },
  "message": "{{inventory.crowbar.title}} makes short work of it.", "state": "success" }
```

Only `eq` and `neq` — a state has no order to it. When several objects answer to the same name, the best state wins: equipped over carried over reachable over absent.

Its sibling **`inventoryCount`** counts how many objects of that *kind* (the same name) the roller has equipped, and takes the ordinary number comparisons: `{ "inventoryCount": { "lockpick": { "gte": 2 } } }`.

The object's name is a **template**, as a wardrobe item's is: `{ "inventory": { "{{params.weapon}}": { "eq": "equipped" } } }` lets whoever reaches for the tool say which weapon they mean.

**A run nobody made has no inventory at all** — and so every `inventory` and `inventoryCount` test declines, `{ "eq": "absent" }` and `{ "lt": 1 }` included. That is the same quiet non-match a missing metadata key gets, and for the same reason: we could not establish anything about a bag that does not exist. Only a real character's bag ever reads as `absent` or `0`.

#### Asking about everything they carry — `inventoryAggregate`

`inventory` asks after one object by name. Sometimes the question is broader: *is anything she carries a suppressor?* *Does he have an ansible resonator equipped, whatever it is called on his sheet?* *What is the best `toolVersion` among the gadgets in her hand?* For that there is **`inventoryAggregate`**, which reads one attribute across *every* object in a scope and hands Pascal the lot.

Its key is written `<scope>.<field>`. The scope says whose objects:

| Scope | The objects counted |
|---|---|
| `equipped` | everything equipped in this chat |
| `owned` | everything in their own vault, equipped or not |
| `reachable` | everything they can see at all — their own, the group's, the project's, Quilltap General |

Each scope includes the one above it. Archetypes, archived objects and kits are never counted (a kit's members speak for it), and an instance carries its archetype's `metadata` as though it were its own.

The field says what is read off each object:

| Field | What Pascal compares |
|---|---|
| `count` | how many objects there are |
| `names` | a list of their names |
| `titles` | a list of their titles (or names, where they have no title) |
| `metadata.<key>` | a list of their values for that `metadata` key — an object whose value is itself a list contributes each entry |
| `metadata.<key>.min`, `.max`, `.sum` | a number, folded from the numeric values among them |
| `metadata.<key>.count` | how many of them carry a number there |

A list is compared **entry by entry**, by the same rule a list on a character's sheet follows: `eq` when any entry matches, `neq` when none does, `contains` and `ncontains` likewise, and no ordering. So the three questions above are:

```json
{ "inventoryAggregate": { "equipped.metadata.toolAbilities": { "contains": "suppress" } } }
{ "inventoryAggregate": { "equipped.names": { "eq": "ansible resonator" } } }
{ "inventoryAggregate": { "equipped.metadata.toolVersion.max": { "gte": 4 } } }
```

The first matches an equipped object whose `toolAbilities` is `"suppress, amplify"` *or* `["suppress", "amplify"]` — each entry is searched on its own, so a word cannot straddle two of them. The second is exact, and so does *not* match an *ansible resonator mk2*, nor an *Ansible Resonator*: case counts here, as it does on `metadata`. The third holds when the largest numeric `toolVersion` among the equipped objects is 4 or better.

The folds want numbers. When nothing in scope carries a number under that key, `.min`, `.max` and `.sum` are simply *absent*, and every test against them declines — `{ "gte": 0 }` and `{ "lt": 0 }` alike. `.count` is always there, and reads `0`. To order a list you must fold it first; `{ "equipped.names": { "gt": 1 } }` is a question without an answer, and the Workbench says so.

One small consequence of the spelling: a metadata key whose own name ends in `.min`, `.max`, `.sum` or `.count` is read as that fold, not as a list. If your objects keep a key called `stats.max`, ask for `stats.max.max` and be done with it.

The key is always literal — it names a scope and a field, never an object — though the value compared against may be a `{ "$param": … }` in an outcome, as anywhere else. And, as with its siblings, **a run nobody made has no inventory to take stock of**: every `inventoryAggregate` test declines. With a real bag, an empty scope is merely a fact: `equipped.count` reads `0`, `equipped.names` is an empty list.

A roll, a comparison or a parameter's default may also draw a value *out* of an object's metadata, with a `$inventory` reference — the `$state` reference's twin, fallback and all:

```json
{ "roll": { "$inventory": "sword.metadata.damage", "fallback": "1d4" } }
```

The object comes first, then `.metadata.`, then the key. As the whole `roll`, the fallback must be dice: a sword whose metadata reads `"damage": "2d6"` rolls 2d6, and a character with no such sword — or a sword with no such key — rolls 1d4. Anywhere else the fallback's type types the reference, exactly as `$state`'s does. A `$inventory` reference may not appear in a gate.

#### Asking how far along something is — `progress`

A character may be carrying **[progressions](character-progressions.md)**: named
spans of time with a beginning and an ending — a recharging cannon, a
gestation, a fuse. `progress` asks after one, keyed `"<identifier>.<field>"`:

```json
{ "when": { "progress": { "cannon.complete": { "eq": true } } },
  "message": "The coils are full. The gun speaks.", "state": "success" }
```

Every field is worked out fresh from the clock at the moment of the roll —
nothing is stored and nothing can go stale:

| Field | What it holds |
|---|---|
| `complete`, `started` | true or false |
| `state` | `pending`, `active`, or `complete` |
| `percent` | a number, and **not** capped at 100 — a fortnight overdue reads well past it, which is a fact a table may reasonably branch on |
| `elapsedMs`, `remainingMs` | milliseconds; `remainingMs` goes *negative* once the ending is past |
| `startTime`, `endTime` | milliseconds since the epoch, so they order and add like any other number |
| `elapsed`, `remaining` | the phrased spans — *2 minutes, 10 seconds* |
| `name` | the progression's display name |
| `quantity` | the current amount, when the progression fills one |

The comparisons are the same eight, ANDed the same way, and `{ "$param": … }`
operands work here too. And the fail-soft rule is exactly the metadata rule,
for exactly the metadata reason: **a character who carries no such
progression simply does not match.** A tool file is written long before it
meets a character, and cannot know which of them keep a cannon. A table
branching on `cannon.complete` must still deal sensibly to the person who has
never owned a gun, and your catch-all is where you say what that means. A
field name that doesn't exist declines the same way.

The one thing `progress` will *not* do is let the model set a due date. There
is no tool for it, and there is no `progress` subject on the `state` tool.
Only you and Pascal's own server-side writes touch a progression.

#### Drawing on persistent state — `$state`

A table may also consult the chat's **persistent state** — the same JSON ledger the `state` tool keeps, and the same four-tier cascade (chat → project → group → general) described in *[Chat State](chat-state.md)*, resolved from the rolling character's own vantage. Wherever a `{ "$param": "…" }` may go — a roll bound, a comparator operand, or a parameter's default — a `$state` reference may go instead:

```json
{ "$state": "weather.wind", "fallback": 0 }
```

The **`fallback` is required**, and it earns its keep twice over. It fixes the reference's *type* when the file loads — a number in a roll field, a string for a `contains` needle — so the same load-time checks that catch a mistyped `$param` catch a mistyped `$state`. And it guarantees the reference can never fail at run time: should the path be absent, or hold a value of the wrong sort, the fallback stands in. A roll is therefore always dealable, whatever state does or does not hold.

The path is read with the same dot-and-bracket notation the `state` tool uses — `player.health`, `inventory[0].name`. (One quiet limitation, shared with the `state` tool: a key containing spaces or literal dots cannot be reached by a path, so name your state keys plainly.)

You may also render state straight into a message with `{{state.path}}`, exactly as you would `{{metadata.key}}` — and it observes the same courtesy: a path that is absent, or holds a list or an object rather than a plain value, leaves the placeholder standing in the sentence rather than swallowing it.

In **Pascal's Workbench**, the proving bench carries a **Mock state** field beside the fact sheet: type a JSON object there to stand in for the cascade while you dry-run or audit a `$state`-using table. Leave it empty and every reference simply takes its fallback — which is, after all, what a run does when there is nothing to draw on.

#### Asking an oracle

Chance settles a great many questions, but not all of them are chance's to settle. *Does the forged invitation pass inspection?* is partly a roll and partly a judgment — and for judgment, a tool may keep an oracle. Add an `llm` block beside your `roll`:

```json
"llm": {
  "prompt": "A forged invitation scored {{value}} out of 10 for craftsmanship, presented by someone whose composure is {{metadata.composure}}. In one word, YES or NO: does the doorman wave it through?",
  "errorMessage": "The doorman squints at the card, and the moment stretches on unresolved."
}
```

With that in place, every run pauses after the roll and puts the rendered `prompt` to your instance's **cheap utility model** — the same modest engine that titles your chats and files your memories, chosen in your cheap-model settings. The prompt takes every placeholder a message does — `{{value}}`, `{{roll}}`, `{{dice}}`, `{{params.…}}`, `{{metadata.…}}`, `{{state.…}}` — everything except `{{llm}}` itself, the oracle being in no position to quote an answer it has not yet given. Ask for the shape of answer your table means to test: a bare word, a number, a sentence.

#### When the table, not the oracle, decides

The doorman above is a *judgment*: the model's answer is the verdict, and the table merely reads it back. There is another, quite different, use for the same block — a **narrator**, where the roll and the table settle what happened and the model merely dresses it in prose. A scanner reports "entanglement confirmed" or "not found", and the *number* has already said which.

For a narrator, do **not** write a prompt that says *"if {{roll}} is at least {{params.layers}}, report success; otherwise report failure"*. That asks a modest model to redo arithmetic the engine finished before the prompt was even written, in the middle of a creative task, with the winning and the losing report both in front of it — and a modest model will sometimes pick the wrong one, in lovely prose, with the right numbers printed beneath. Let the table decide, and *tell* the model what it decided. Give each outcome a `brief`:

```json
"llm": {
  "prompt": "Write a short scan report for {{params.scan_target}}, in the technical register of the near future. The conclusion you must reach: {{outcome.brief}}. Do not mention that this is fiction or that dice were rolled.",
  "errorMessage": "The ansible link falters."
},
"outcomes": [
  { "when": { "gte": { "$param": "layers" } }, "state": "success",
    "brief": "Report that entanglement with {{params.partner}} is definitively confirmed, at very high confidence.",
    "message": "{{llm}}" },
  { "when": true, "state": "failure",
    "brief": "Report that entanglement was not definitively found, leaving room for observer interference.",
    "message": "{{llm}}" }
]
```

The table is dealt **first**, the winning row's `brief` is rendered, and only then is the oracle consulted — so the prompt can quote:

| | |
|---|---|
| `{{outcome.brief}}` | the winning row's `brief`, with its own placeholders already filled in |
| `{{outcome.state}}` | the winning row's state: `success`, `partial`, `failure` or `info` |
| `{{outcome.index}}` | the winning row's position, counting from 0 (the number the roll record keeps) |

The same three placeholders may be quoted in the outcome messages, the chip label and the effects, where the table has plainly already been dealt. A few rules keep the order honest:

- **If any outcome tests `llm`** (the answer, or its `ok`), the table needs the oracle first, so the oracle cannot read the verdict. The old order holds, and a prompt that quotes `{{outcome.…}}` is refused when the file loads. Pick one: the oracle judges, or the table does.
- A `brief` is written before the oracle speaks, so it may not quote `{{llm}}` or `{{outcome.…}}` either. It needs an `llm` block to be read at all.
- A row without a `brief` is not an error, but if the prompt reads `{{outcome.brief}}` and that row wins, the placeholder reaches the model as written. The Workbench warns about every such row, and its audit names any that actually fired.
- For wording you must have *exactly*, skip the model: write the conclusion into the row's `message` after `{{llm}}`.

What comes back is a pair — *did the oracle answer*, and *what did it say* — and the outcome table may ask about both under the `llm` subject:

```json
{ "when": { "llm": { "ok": false } },  "message": "{{llm}}",                       "state": "failure" },
{ "when": { "llm": { "eq": "YES" } },  "message": "The rope lifts. \"{{llm}},\" says the doorman.", "state": "success" },
{ "when": true,                        "message": "The doorman is unmoved.",       "state": "partial" }
```

The comparisons are forgiving in exactly the ways an oracle requires. `eq` and `neq` compare the answer trimmed and without regard to case, and forgive a trailing full stop — you asked for `YES`, and a model that says `yes.` has still said yes. `contains` and `ncontains` are the natural fit for an oracle allowed whole sentences: `{ "llm": { "contains": "west door" } }` matches *"You will find the West Door unbarred"* without demanding the sentence verbatim, the search being every bit as indifferent to case as `eq` is here. The ordering four (`gt`, `gte`, `lt`, `lte`) apply when the answer reads as a number — ask the oracle to *rate the attempt from 1 to 10* and band the table on the rating — and when the answer is not a number they simply decline the row, fail-soft, exactly as a metadata test declines for a character without the key. And `ok` is the one extra: `{ "ok": true }` holds only when the consult produced an answer, `{ "ok": false }` only when it did not.

**When the oracle is silent** — the provider is down, no cheap model is configured, the call times out, the answer comes back empty — the run does **not** fail, and no error bubble interrupts the scene. Instead the answer *becomes your `errorMessage`*, word for word, with `ok` set false, and the table deals with it like anything else. The technical reason is kept for the roll record and the logs; the fiction only ever hears what you wrote. Every table that keeps an oracle should decide what silence means — an `ok: false` row near the top, or simply trust in the catch-all, which as ever answers for everything.

A word on length: by default the answer is kept to eight thousand characters. If your oracle is the laconic sort — a verdict, a rating — or the opposite — a consult whose answer *is* the deliverable, a generated document at full length — set `maxOutput` in the block (`"maxOutput": 50000`, up to one hundred thousand) and the answer is trimmed to *that* instead, with the call's token budget scaled to match. Your `errorMessage` is never subject to it; those are your words, kept whole.

Two practicalities. First, the consult costs one cheap-model call per run — real money on a metered provider, though of the smallest denomination, and rather more of it if you set a generous `maxOutput` and the oracle uses the room. Second, the models *playing* in your scene are told only that the tool consults an oracle; the prompt itself is never shown to them, and `revealOdds: false` hides the branching along with everything else. Quilltap insists, and refuses to load a tool that ends any other way. The reason is that a table with a gap in it is a table that will one day produce a roll matching nothing at all, at the worst possible moment, in front of everybody. Requiring a catch-all at the end makes that impossible rather than merely unlikely. For the same reason, a `true` anywhere *except* the end is refused too — everything below it could never be reached, which is never what anyone meant.

`state` is one of `success`, `partial`, `failure`, or `info`. It tints Pascal's announcement accordingly — the bar above the outcome carries the same coloured edge and the same coloured mark beside Pascal's name, so a reader scrolling past a long scene can tell how a roll went without stopping to read it. The four states wear the same colours here as they do on the outcome rows in Pascal's Workbench and in the proving bench's preview. You never write any styling yourself.

### Putting things in the message

These may be dropped into a `message`:

| | |
|---|---|
| `{{value}}` | the final number, after the transformation |
| `{{roll}}` | the raw number, before it |
| `{{dice}}` | the dice breakdown, e.g. `3d6+2: [4, 2, 6] + 2 = 14` (empty if you're not rolling dice) |
| `{{character}}` | the name of the character who rolled |
| `{{params.bonus}}` | a parameter, as it was actually used — after defaulting and clamping |
| `{{metadata.faction}}` | a key from the roller's fact sheet |
| `{{state.weather.wind}}` | a path into persistent state (the four-tier cascade) |
| `{{progress.cannon.percent}}` | a field of one of the roller's timed progressions |
| `{{inventory.sword.title}}` | an object the roller carries or can reach: `.title` (its title, or its name when it has none), `.name`, `.description`, `.state`, or `.metadata.<key>` |
| `{{now}}` | the moment the run began, in milliseconds since the epoch |
| `{{llm}}` | what the oracle answered — or, after a failed consult, your `errorMessage`, word for word |
| `{{outcome.state}}`, `{{outcome.index}}`, `{{outcome.brief}}` | the winning row's state, 0-based position and [`brief`](#when-the-table-not-the-oracle-decides) |

Anything else in braces is left exactly as you typed it — as is an `{{inventory.…}}` naming an object the roller cannot reach (its `.state` alone still says `absent`), a `{{metadata.…}}` naming a key the roller hasn't got, or one holding a list or an object, or a `{{progress.…}}` naming a progression they aren't carrying, or a `{{character}}` on a roll that nobody in particular made (you, from the run dialog, as no one).

`{{character}}` is the roller and nobody else: the character who reached for the tool, who said the trigger phrase, or in whose name you ran it. It goes wherever a message's placeholders go — the chip label, the oracle's prompt, an effect's expression, and a wardrobe item's name, so `"{{character}}'s armour"` dresses each roller in their own.

`{{now}}` is fixed for the whole run: two effects that both quote it agree to the millisecond, which is what makes `{{now}} + 600000` a sound way to say "ten minutes hence" without the format needing a date grammar of its own. The placeholder stands there in the sentence looking conspicuous, which is the point: it tells you exactly which key is missing, where an empty space would merely leave you puzzled. If a message leans on `{{metadata.faction}}`, gate its row on `faction` and let the catch-all speak for the factionless.

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

## Naming each run — `chipLabel`

The Salon labels every outcome with the tool that produced it — the chip above the bubble reads *Force the Lock*, and so does the bold heading of Pascal's announcement. For most tools that is exactly right. But a tool that does many *different* things per run — a dispatcher, a generator, a drawer of many things — wants each run named for what it did, not merely for the machinery that did it.

Give it a `chipLabel`: a small template, rendered *after* the outcome is chosen, with every placeholder a message takes:

```json
{ "chipLabel": "Agent lambda — {{params.label}}" }
```

One string then labels both the chip and the announcement heading, so the transcript and the chip can never disagree. Leave it out (or let it render blank) and the title labels the chip, as it always has.

Your characters never see the template — like `title`, it is display furniture, not vocabulary. If you want the *model* to name the run, do it the honest way: declare a string parameter whose `description` invites a short label, then quote it —

```json
{
  "parameters": {
    "label": { "type": "string", "default": "", "description": "A short human label for this run — who or what it concerns." }
  },
  "chipLabel": "Agent lambda — {{params.label}}"
}
```

## Words that pull the lever — `triggers`

A dice roll typed into a chat is thrown at once, without anybody reaching for a tool. A custom tool has, until now, lacked that reflex: it waited for a character to call it or for you to open the dialog. Yet a great many tools are *about* something that gets said. *"I draw my sword"* could roll for initiative; *"Abracadabra"* could set the transformation going; *"Let us see what the oracle says"* could, with a certain inevitability, consult the oracle. You know the words. Now you may tell Pascal to listen for them:

```json
{ "triggers": ["abracadabra", "open sesame"] }
```

Up to eight phrases per tool, each between three and eighty characters. When a message in the chat contains one, Pascal runs the tool on the spot and announces the outcome exactly as he would for any other run.

**What counts as a match.** The plainest rule there is: the phrase appears in the message, in any mixture of capitals. No wildcards, no word boundaries, no cleverness. `"fire"` will go off at *"warm by the fireplace"* as readily as at *"Fire!"* — if you want precision, write a longer phrase. A phrase must not begin or end with a space, and two phrases of one tool may not differ only in their capitals.

**Who can set one off.** Everyone who speaks: you, a character you are playing, and every character the models are playing, autonomous rooms included. The tool runs *as the speaker* — their fact sheet, their groups, their version of the tool if it is defined differently for different characters — so a tool gated away from a character cannot be triggered by them, either. When you speak as nobody in particular, the tool rolls as nobody: every metadata test declines, and effects that need a character are skipped.

**What Pascal never listens to.** His own announcements, Carina's answers, and the remarks of the rest of the staff — the Host, the Lantern, Aurora, Prospero and the Post Office. A [Carina](carina.md) question line (`@Name: …`) is set aside too: it is addressed to the reference desk, not spoken in the scene. A regenerated reply fires nothing, just as dice in a swipe are not re-thrown.

**How it rolls.** Every parameter at its default — there is nobody to fill in a form. Visibility follows the tool's own `defaultVisibility`: a whispering tool whispers to whoever spoke the words. The announcement lands *after* the message that caused it (dice, by long habit, land before yours; Pascal is more of a respecter of sequence).

**At most four tools per message.** Should one sentence happen to contain the phrases of six tools, the first four to appear are dealt and the rest are noted in the logs, not run — a sentence should not be able to spend six oracle consultations on your account.

**A word on echoes.** Pascal never hears himself, but a character who *repeats* Pascal's announcement in their own reply will say whatever words it contains — and if those include the tool's own trigger, the tool goes off again on that reply, and possibly again on the next. The Workbench warns you when an outcome message, the chip label or an oracle prompt quotes one of the tool's own phrases. Heed it.

**It must be switched on.** All of this sleeps until you turn on **Auto-Run Custom Tools on Trigger Phrases** under Settings → Chat → Automation. It is off by default — being overheard is a surprise the first time — and it does nothing at all while Custom Tools itself is switched off. The phrases are never shown to any model; `run_custom` remains a character's own way to reach for the tool.

## Recording consequences — side effects

A roll can now leave a mark. A tool may carry an `effects` array — up to sixteen entries, applied in order after the table has dealt — each writing one value into the story's **persistent state** or onto the rolling character's own **fact sheet**, or else changing what that character **has on** (see *[Dressing and undressing](#dressing-and-undressing)* below). The third failed lockpick really can break the pick, and nobody has to *ask* the model to record it — the write happens on the server, as part of the roll, entirely beyond a model's power to fudge:

```json
"effects": [
  { "when": { "outcome": { "eq": "failure" } }, "target": "state.lockpicking.failures",
    "value": "{{state.lockpicking.failures}} + 1" },
  { "when": { "outcome": { "eq": "failure" } , "gte": 3 }, "target": "metadata.lockpick",
    "value": "'broken pick'" }
]
```

Each effect has three parts:

- **`when`** — optional; omit it and the effect fires on every run. It takes everything an outcome's `when` takes, plus one subject only an effect can ask about: `outcome`, the winning row's state — `{ "outcome": { "eq": "failure" } }` fires only on a failure, `{ "neq": "success" }` on anything short of one.
- **`target`** — where to write. `state.<path>` reaches into the persistent-state cascade, and the write lands **at the tier where the key already lives** — a counter kept in project state stays in project state — defaulting to the chat (the most local ledger) for a key found nowhere. `metadata.<key>` writes onto the rolling character's `metadata.json`; the part after `metadata.` is taken whole, dots and all. `progress.<id>.<field>` adjusts one of their timed [progressions](character-progressions.md), described just below. Keys beginning with an underscore are yours alone, and no tool may write them — see *[Chat State](chat-state.md)*.

### Adjusting a progression

`progress.<identifier>.<field>` is how a tool re-arms a countdown. The classic
case is a gun that has just been fired:

```json
"effects": [
  { "when": { "outcome": { "eq": "success" } },
    "target": "progress.cannon.startTime", "value": "{{now}}" },
  { "when": { "outcome": { "eq": "success" } },
    "target": "progress.cannon.endTime",   "value": "{{now}} + 600000" }
]
```

Pair that with the `availableWhen` gate above and the whole cycle looks after
itself: the tool vanishes from the roster the instant it fires, and returns
ten minutes later.

The fields you may write are `name`, `description`, `startTime`, `endTime`,
`timeIncrement`, `percentageReport`, `reportFrequency`, `onComplete`,
`reportTemplate`, `quantity.total`, `quantity.unit`, `quantity.precision` —
and the pseudo-field **`remove`**, where writing `true` deletes the
progression outright. Anything else (`percent`, say, which is worked out
rather than kept) is refused when the file loads, with the list of what you
may write instead.

Four conveniences worth knowing:

- **Times take either form.** A number is read as milliseconds since the epoch
  — which is what `{{now}} + 600000` evaluates to — and a string is read as an
  ISO instant. Both are filed as ISO, so the vault stays legible.
- **Writing to an identifier nobody authored creates it**, sensibly furnished:
  named for its identifier, beginning now, ending an hour hence, and *spoken
  in* a unit inferred from however long the span turns out to be. A tool may
  therefore start a countdown no human wrote in advance.
- **Effects see each other.** They apply in file order against one working
  copy, so writing `endTime` before `startTime` is perfectly sound.
- **The character is told at once.** Every progression a run touches is
  stamped as freshly changed, so the next turn reports it whatever its cadence
  says — a re-armed cannon does not wait an hour to be mentioned.

And should the writes leave a progression the format cannot accept — an ending
that now falls before its beginning — *that progression's* writes are dropped
and its previous state restored. The roll still stands and Pascal still
announces; a mistyped countdown has never been worth sinking a hand that was
already dealt.

One door is deliberately barred: **`metadata.progressions` is refused when the
file loads.** An effect's value is always a single plain value, so writing to
the reserved key that way would replace every progression the character has
with a lone string — around the validation, around the restoration above, and
quietly enough that nobody would notice until a report went missing. Write
`progress.<id>.<field>` instead, which is the door with the locks on it.
(`metadata.progressions.cannon` is refused too, for a nearby reason: metadata
keys are taken whole, so that would file a key *named* `progressions.cannon`
and leave the cannon entirely alone.)
- **`value`** — what to write. A JSON number or `true`/`false` is stored as it stands. A JSON **string is always an expression**: a little closed arithmetic of `+ − × ÷`, parentheses, quoted text, and the same `{{…}}` references a message takes — `"{{value}} * 2"`, `"'rolled ' + {{dice}}"`.

**The one trap, stated in bold so you meet it here and not in a rejection badge: literal prose must be quoted *inside* the expression.**

```json
{ "target": "metadata.lockpick", "value": "'broken pick'" }     ✓
{ "target": "metadata.lockpick", "value": "broken pick" }       ✗ refused when the file loads
```

The bare form is two words where the grammar expects an expression, and the file is refused on the spot — loudly, when the file loads, never silently mid-scene.

A few civilities, all in the fail-soft family you know from `metadata`: an expression that cannot be evaluated at run time (a division by zero, a `{{metadata.key}}` the roller hasn't got) skips *that one effect* and never sinks the roll; a run with no character attached skips the `metadata.` writes (a run nobody made writes to nobody's sheet — which includes an unattributed roll of your own from the composer); and everything that *was* written rides in the roll's permanent record, previous value and all. The oracle's answer may be written too — `"value": "{{llm}}"` files the consult's text — but it is never treated as a number; route numeric judgments through the outcome table instead.

### Dressing and undressing

An effect need not write a value at all. Give it a `wardrobe` key in place of `target` and `value` — never both — and it changes the rolling character's outfit instead: the dress tears and comes off, the Cloak of Night is drawn from the chest and donned, the beast-form sweeps the slots clean. It all happens on the server, through precisely the same valet's hands the `wardrobe_wear` and `wardrobe_take_off` tools use, and so it cannot be forgotten, fudged, or applied to the wrong garment by an over-excited model.

```json
"effects": [
  { "when": { "outcome": { "eq": "success" } },
    "wardrobe": { "action": "wear", "items": ["Cloak of Night", "{{params.garment}}"] } },
  { "when": { "outcome": { "eq": "failure" } },
    "wardrobe": { "action": "take_off", "items": ["Sundress"] } },
  { "wardrobe": { "action": "clear_slot", "slot": "hair" } }
]
```

Three actions, each fussy about its own particulars:

- **`wear`** puts the listed `items` on, in order. An optional **`mode`** means exactly what it means to `wardrobe_wear`: `wear` (the default — honour each item's own *replace* setting), `replace` (a decisive swap), or `add_to_slot` (tuck it into one named `slot`, which that mode then requires and no other mode accepts).
- **`take_off`** takes the listed `items` off, leaving every other layer where it lies. Name a `slot` to take an item out of that slot alone; leave it off and the item comes off everywhere it covers. `mode` has no business here.
- **`clear_slot`** empties one `slot` — `top`, `bottom`, `footwear`, `accessories` or `hair` — and takes neither `items` nor `mode`.

A file that puts a field where its action has no use for it is refused when it loads, with the reason beside the offending line.

**Items are named by title or id.** Each is looked up the way a character's own wardrobe tools look things up — the id first, then the title, without regard to case — across everything the rolling character may wear: their own wardrobe, their groups', the project's, and Quilltap General. An item is a *template*, not an expression: the `{{…}}` placeholders a message takes are filled in before the lookup, so `"{{params.garment}}"` lets the person rolling choose the garment, and `"{{metadata.favouriteHat}}"` lets the character's own fact sheet choose it. There is no arithmetic and no quoting trap here — the words you write are the words looked up. In [Pascal's Workbench](pascals-workbench.md) the **Choose…** picker fills these in for you, and shows what each name reaches.

**Outfits wear and come off whole.** A composite outfit goes on like any garment, and comes off the same way: everything of it the character has on is taken off, whichever slots its pieces landed in.

**The rolling character, and nobody else.** A wardrobe effect dresses whoever the tool was run *as* — the same person a `metadata.` write lands on. A tool one character runs cannot undress another, and a run nobody made (your own unattributed roll from the composer) dresses nobody at all.

**One missing garment never spoils the evening.** An item that cannot be found, has been archived (for wearing — an archived garment may still be taken *off*), or does not cover the `add_to_slot` slot is skipped quietly, and the rest of the list goes on. The roll has happened; Pascal announces it regardless.

Afterwards [Aurora](wardrobe.md#auroras-wardrobe-announcements) announces the new ensemble in the usual way — once per turn, even when a character's own `wardrobe_wear` call and a tool's wardrobe effect both landed in the same reply — and the character's per-chat portrait is redrawn if the chat has asked for that. The roll's permanent record notes what went on, what came off, and the outfit before and after.

#### A tool that simply dresses someone

There is no rule that a tool must be a gamble. A tool with one possible roll and one outcome is a button — and a button that dresses a character is a very handsome thing to have in the composer:

```json
{
  "name": "wear_regalia",
  "title": "Don the Regalia",
  "description": "Put on the full ceremonial regalia, for an investiture or a very good dinner.",
  "roll": { "min": 1, "max": 1 },
  "effects": [
    { "wardrobe": { "action": "wear", "items": ["Regalia"], "mode": "replace" } }
  ],
  "outcomes": [
    { "when": true, "message": "The regalia goes on, and the room rises.", "state": "success" }
  ]
}
```

Run it from the composer **as** a character and on it goes; a character may equally run it themselves. A `take_off` twin makes the matching button for the end of the evening.

Your characters are told a tool records side effects and *where* it writes (the targets are vocabulary, like a parameter's name) — never the values or the conditions, and under `revealOdds: false` not even the targets. A wardrobe effect is described the same way — *wears Cloak of Night, Boots*, *takes off {{params.garment}}*, *clears hair* — naming what may be worn, never which roll wears it. The run dialog names them too, under **What this tool can quote**. And on the Workbench, the proving bench shows every would-be write as a dry run — `→ state.lockpicking.failures = 3 (would write)` — while applying, as ever, nothing at all. A wardrobe effect shows as `→ wardrobe: wear “Cloak of Night” (would attempt)` — *attempt*, because the bench has no character in the chair and so cannot know whether the garment is in anyone's wardrobe.

### Equipping, setting down and picking up

An effect may change what the rolling character *carries*, too. Give it an `inventory` key in place of `target` and `value` (or `wardrobe` — one of the three, never two):

```json
"effects": [
  { "when": { "outcome": { "eq": "success" } },
    "inventory": { "action": "pick_up", "items": ["{{params.loot}}"] } },
  { "when": { "outcome": { "eq": "failure" } },
    "inventory": { "action": "unequip", "items": ["lantern"] } }
]
```

- **`equip`** takes up the listed objects, or kits.
- **`unequip`** sets them down; a kit sets down every member it holds.
- **`pick_up`** names **archetypes**, and makes an instance of each in the rolling character's own vault, equipping it unless you add `"equip": false`. (`equip` means nothing to the other two actions, and a file that says it there is refused.)

The objects are named, and found, exactly as the characters' own `inventory_*` tools find them — by id, then title, then name — and each is a template, so `"{{params.loot}}"` lets the roller choose. It all goes through the same machinery as the Carrying now pane, so the limits hold: should picking up a magic bow put one bow too many in the character's hands, *that* gesture is skipped whole — no bow is made — and the roll's other effects, and Pascal's announcement, carry on regardless. An object that cannot be found is skipped quietly. The character's own `inventory_*` calls and a tool's inventory effects in one reply all make **one** line from Pascal at the end of it.

The roll's permanent record notes each object taken up, set down or picked up, and what the character carried before and after. A run nobody made carries nothing.

### Writing to the log

An effect may also write a line to [the Log](the-log.md), the instance-wide book that every character can search. Give it a `log` key in place of `target` and `value` (or `wardrobe`, or `inventory`: one of the four, never two):

```json
"effects": [
  { "when": { "outcome": { "eq": "failure" } },
    "log": "{{character}} failed the lock at {{params.door}} (rolled {{roll}})." }
]
```

The value is a **template**, like an outcome's message: plain prose with `{{value}}`, `{{roll}}`, `{{dice}}`, `{{character}}`, `{{params.x}}`, `{{metadata.key}}`, `{{state.path}}`, `{{llm}}` and the rest, and no inner quoting. It may run to 1,000 characters. Log effects are applied after all the others, and the line is recorded against the chat and the rolling character. A line that renders empty is skipped. Your characters are told only that the tool *writes to the log*, never what it writes.

## Which tool wins: the matter of tiers

The same tool name may reasonably exist in several stores, and Quilltap resolves the question by proximity. Nearest to the character wins:

**their own vault → a group store → a project store → Quilltap General**

So an `unlock` in a character's own vault quietly supersedes the project's `unlock`, for that character only. This is how one gives a locksmith better odds than everybody else without anybody else noticing.

**A character's vault is a private pocket, not a communal sideboard.** The tools in a character's own `Tools/` folder are dealt to that character and to nobody else — sharing a room with the locksmith does not put her picks in anybody else's hand, nor does her `disabled` tombstone switch off anybody else's tool. (The group tier is likewise the roller's own: a character is dealt the stores of the groups *they* belong to, never a companion's.) A tool meant for the whole table belongs in a group, project or General store.

To switch off an inherited tool rather than replace it, define it nearer and mark it `"disabled": true`:

```json
{ "name": "unlock", "description": "Not for this one.", "disabled": true,
  "outcomes": [{ "when": true, "message": "-", "state": "info" }] }
```

The name is then suppressed at that tier and every tier beyond it.

If two stores at the *same* distance both define a name, Quilltap picks one deterministically and notes the fact — but this is a coin-toss you did not intend to write, and is worth tidying up.

## Who may reach for it at all

A tier decides *which* `unlock` a character gets. Sometimes the question is prior to that: whether this character has any business being offered the tool in the first place. An automaton with a programming port may reprogram things; the parlourmaid, whatever her other gifts, may not, and she should not be handed the option and left to discover it politely refuses her.

Two optional keys settle it, and only one of them may appear in a file:

```json
{
  "name": "reprogram",
  "description": "Rewrite the instructions of a mechanism you can reach.",
  "availableWhen": { "metadata": { "toolAbilities": { "contains": "programmable" } } },
  "outcomes": [ … ]
}
```

- **`availableWhen`** — offer this tool *only* to a character whose fact sheet passes every test in it.
- **`withheldWhen`** — the mirror: keep it *from* a character whose sheet passes every test in it.

The tests are written exactly as an outcome's `metadata` clause is, and several of them AND together. What is different is *when* they are asked: before the deal, before there is a roll or a parameter or an oracle's answer to speak of. That is why the subjects can only ever be `metadata`, `progress`, `inventory`, `inventoryCount` and `inventoryAggregate` — a character's fact sheet, the timed spans derived from it, and what they carry in this chat are what they bring into the room — and why the values compared against must be plain literals rather than `{ "$param": … }`, `{ "$state": … }` or `{ "$inventory": … }` references. There is nothing yet for those to refer to. For the same reason an `inventory` key in a gate must name its object literally: a gate is asked before anyone has supplied a parameter, so `{{params.weapon}}` there would never mean anything but itself, and the loader refuses it.

`inventory` in a gate is the sword-swinger's arrangement:

```json
{ "availableWhen": { "inventory": { "sword": { "eq": "equipped" } } } }
```

A character with a sword in hand is offered `swing_sword`; one without is not — and, since a gate with nothing to read declines, neither is a roll made as nobody from the composer.

`inventoryAggregate` in a gate asks after the whole bag at once — offer `jam_signal` to anyone with *something* equipped that can suppress:

```json
{ "availableWhen": { "inventoryAggregate": { "equipped.metadata.toolAbilities": { "contains": "suppress" } } } }
```

**A gate may say "or", too.** Write either clause as a list of such objects, and it holds when *any one of them* does — the same rule, and the same one level of it, as an outcome's `when`:

```json
{ "availableWhen": [
    { "metadata": { "toolAbilities": { "contains": "programmable" } } },
    { "inventoryAggregate": { "equipped.names": { "eq": "ansible resonator" } } }
] }
```

The automaton with a port is offered `reprogram`; so is the parlourmaid who has had the foresight to equip an ansible resonator. The fail-soft table below holds line by line: a character the gate can learn nothing about passes no line, so an `availableWhen` stays shut and a `withheldWhen` stays unsatisfied.

`progress` in a gate is the whole recharging-weapon arrangement in one line:

```json
{ "availableWhen": { "progress": { "cannon.complete": { "eq": true } } } }
```

While the coils are filling, `fire_cannon` is not on the roster at all. The
moment they are full, it is. Nobody had to remember to enable anything.

**A withheld tool is not merely greyed out. It is not there.** The model is never told it exists, the composer's run dialog does not list it, and `run_custom` will not run it if the model asks for it by name. (The gate is asked of each character severally, so a tool withheld from *your* character but offered to another still appears in your own dialog — labelled with the character it would run as. See *Whose fact sheet* below.) There is nothing to be tempted by, which is the humane arrangement: a tool a character can see and cannot use is an invitation to spend a turn being refused.

**A key the character lacks never matches** — the same fail-soft rule the outcome table follows. Read through the gate, this cuts opposite ways for the two clauses, which is precisely why both exist:

| The character's sheet | `availableWhen` | `withheldWhen` |
| --- | --- | --- |
| passes the test | offered | withheld |
| fails the test | withheld | offered |
| has no such key at all | withheld | offered |
| has no sheet whatever | withheld | offered |

So `availableWhen` is the cautious key — a stranger with no fact sheet gets nothing — and `withheldWhen` is the permissive one, which excludes only those you have positively identified.

**A gated-out tool does not claim its name**, and this is quietly the most useful thing about the arrangement. Should a character's own vault hold a clever `unlock` gated to picklock-carrying characters, and Quilltap General hold a plain one gated to nobody, then the picklock carries the clever version and everyone else falls through to the plain one — same name, same call, different contrivance. Contrast `disabled`, which suppresses a name outright at its tier and beyond. (You may combine them, and it reads as it says: a `disabled` definition with a `withheldWhen` is a tombstone that only tombstones for the characters it names.)

You need not write any of this by hand. Pascal's Workbench puts it at the top of the recipe as **Who may reach for it** — *Anyone*, *Only show if…*, or *Do not show if…* — with an **AND / OR** toggle between its tests, and its proving bench will tell you whether the fact sheet on the bench would have been dealt the tool at all, and by which line.

## Rolling in secret

Some rolls should not be public knowledge. Set `"defaultVisibility": "whisper"` and Pascal will whisper the outcome to the character who rolled, and to nobody else — the other characters' contexts simply do not contain it. A character may also whisper a single roll by asking privately, and you may tick **Roll privately** in the run dialog, which hides the outcome from every character at once.

**You always see it.** Whoever the whisper is for, it renders for you. This establishment has one proprietor, and there is nothing to be gained by keeping you in the dark about your own dice.

## Letting the character say it — `announceAsCharacter`

Pascal announces every outcome by default, under his own name and his own face. Set `"announceAsCharacter": true` and he stands aside: the character who rolled delivers the outcome instead, their portrait and name on the bubble, and the other characters hear it as that character's line. It suits a tool whose result is something the roller *does* — suiting up, drawing a blade, reciting the incantation — and pairs naturally with `{{character}}` in the message.

Nothing else changes. The outcome is still a genuine roll that Pascal keeps the books on — the chip, the coloured edge for success or failure, and the full record of the deal are all there — and a whispered tool still whispers. Should nobody in particular have rolled (you, from the run dialog, as no one), there is no character to speak, and Pascal announces it as usual.

## On keeping the odds to yourself

Set `"revealOdds": false` and a character is told only the tool's name, its description, and its parameters. The roll spec and the outcome table are withheld — they know they may attempt the lock; they do not know what it takes.

**Fact sheets are never enumerated to anybody, whatever `revealOdds` says.** A character is told, in general terms, that a table may consult their metadata; they are never handed a list of their keys, nor anyone else's, nor the values. Those belong to each character severally, and printing them into every participant's tool listing would be a poor way to keep a secret. Do note the other half of this, though: when `revealOdds` is left at its default of `true`, that table's `when` clauses are shown — *including* its metadata clauses. A character reading `your hasAnsibleAccess = true → success` has learned what the lock wants, if not whether they have it. If the condition itself is the secret, set `revealOdds: false`.

**One honest caveat, which you should read before relying on this.** `revealOdds` hides the odds from the *tool listing*. It does not make the file secret. A `.tool.json` is an ordinary document in an ordinary store, and a character with read access to that store can simply open it and read the odds for themselves, as they could any other document.

If the odds must genuinely be secret, put the file in a store the character cannot read. Quilltap's per-document and per-store permissions already do this properly; `revealOdds` is a courtesy, not a lock.

## Rolling one yourself

When a scene has any custom tools, a button appears in the composer's left-hand gutter. It opens a proper dialog — one you may dismiss with Escape, with the backdrop, or with **Cancel**, and which does not close itself the moment your attention wanders.

It arrives in two acts. First the table: every tool available to this scene, with its description and the file it came from, and a search box once there are more than a handful. Choose one and the dialog's contents give way to that tool's own form — its parameters laid out with their descriptions and their declared bounds, a **Roll privately** tick, and a Run button. **Choose another tool** takes you back to the table, as often as you like.

It remembers. Close the dialog and reopen it, and you are back on the tool you last used, with the figures you last set still in their boxes. This is deliberate: the same roll is usually wanted twice, and re-typing it is a tax on the second one.

The composer offers a shorter road. Type `/pascal` at the start of a word to open the same dialog, or `/` and a tool's name — `/unlock` — to land straight upon that tool's form with your remembered figures waiting. A tool that declares no parameters at all is rolled the moment you choose it, with its definition's own preference for public or private. To whisper a roll that would otherwise be public, use the dialog. See [Slash Commands](chat-settings-composer.md).

### Presets — hands set aside for later

Memory of the last hand is all very well, but some tools are run the same three ways for a season at a stretch, and for those the dialog offers **presets**. Beneath a tool's parameters — provided it has any, and provided the roll runs as a character with a vault to keep things in — you will find a modest row of conveniences: a dropdown of hands set aside earlier, a box for naming a new one, **Save preset**, and **Reset to defaults**.

**Save preset** files the figures currently in the boxes under the name you give, as a small JSON document in the running character's vault: `Tools/{tool}.{preset}.settings.json`, sitting companionably beside the tool definitions themselves. It is an ordinary file — you may read it, edit it, or discard it from [The Scriptorium](scriptorium.md) like any other, and it travels with the character wherever the vault goes. Saving under a name already taken quietly replaces the earlier hand, which is usually what you meant.

The name itself is kept respectable by force: lowercase letters, digits, hyphens, and underscores, and nothing else — no spaces, no dots, and certainly no directory separators. The box simply declines to accept anything the filename could not carry.

Choosing a preset from the dropdown deals it back into the form. The binding is deliberately loose: each entry in the file lands in the parameter of the same name, entries naming no current parameter are ignored without comment, and parameters the file does not mention keep whatever they held. A preset saved against an older draft of a tool therefore ages gracefully rather than refusing to load. **Reset to defaults** returns every box to what the definition itself prescribes, as though you had opened the tool for the first time.

### What a tool can quote

At the foot of the dialog is **What this tool can quote** — the placeholders *this particular tool* actually uses when Pascal writes the outcome.

The emphasis is on *actually*. Nothing is listed because the format allows it: a tool that rolls dice but never writes `{{dice}}` is not offered `{{dice}}`, and a parameter you are filling in appears here only if some message or prompt quotes it back. What you get is one entry for each of `{{value}}`, `{{roll}}`, `{{dice}}`, and `{{llm}}` the tool genuinely writes, one per parameter it genuinely quotes, and — the useful part — one for every metadata key and state path the definition genuinely reads, named. The Inventory has sentences of its own: which objects the tool reads the inventory for, which aggregates it takes stock of (`equipped.names` and the like), and which objects it may equip, unequip or pick up for the running character. If a table branches on `hasAnsibleAccess`, the dialog says so, and you need not go opening files to find out what the thing wants to know about your character. A tool that quotes nothing gets no panel at all.

**These are the author's to place, not yours to type.** The placeholders belong to the tool's own outcome messages and oracle prompt, which are written on Pascal's Workbench. What you type into the form above is sent exactly as written — braces and all — so `{{metadata.rank}}` in a parameter box is the literal text `{{metadata.rank}}`, not a substitution waiting to happen.

The wrench beside any tool opens it on the Workbench, should reading the file settle the question faster than reading about it.

Rolling this way posts one thing: the outcome, exactly as it would have appeared had a character rolled it themselves. Pascal is a croupier and not a raconteur — he lays out the result and says nothing else about it.

**Which means nothing records that it was you.** Should you nudge a parameter before rolling, that is between you and the wheel: the transcript does not note that the operator reached for the tool, nor what figures you chose, and no character can read what you did to arrange the odds. They see what befell. This seems to us the correct division of information.

Should a tool be defined differently for different characters — or kept in one character's vault, so that only they hold it at all — you'll see each variant listed with the character's name beside it, and running it rolls that character's version — fact sheet and all, so a metadata-gated table deals to that character exactly as it would have done had they reached for it themselves.

**Whose fact sheet, when the tool is everyone's.** A tool is listed *once* when it resolves to the same file for everyone at the table — and metadata lives on the character, not in the file, so a metadata-gated tool that everyone shares is listed exactly that way. Running it still rolls as *somebody*, and that somebody is you: the character you are playing in this scene, or the one you are presently typing as when you are playing several. Your sheet is the one the table tests, and your character's groups are the ones a `$state` reference resolves through.

**And when it cannot be you, the row says so.** Two cases: a room in which you are playing nobody at all, and a tool whose gate your own character did not pass. Neither leaves anything to run as except another participant, so rather than borrow their sheet in silence the listing puts their name beside the tool — *as Friday* — exactly as it does for a tool defined differently per character. The pick is still not yours to make, but you can see it before you commit to it; where it matters, have that character reach for the tool in the fiction instead of reaching for it yourself from the gutter.

## Letting a character write one — `edit_custom_tool`

A character may draw up a tool of its own, or mend one, through **`edit_custom_tool`**. It is offered wherever Custom Tools is switched on, whether or not the scene has any tools yet — which is precisely when somebody needs to write the first one.

The character names a store (`self` for its own vault) and a file. The file may be given whole (`unlock.tool.json`) or by its name alone (`unlock`), and it always lives directly inside that store's top-level `Tools/` folder. A subfolder, or any other folder, is politely declined.

**Every save is checked before a byte is written.** The definition is held to the very same standard the table holds it to when it loads, and a tool that would land under *Would not read* is not saved at all; the character is told what is amiss and may try again. A second file in the same store claiming the same `name` is refused on the same grounds. A tool that passes is saved like any other document — the Librarian announces it, and the store's own permissions apply.

**Called with no content, it writes nothing.** It reads the file as it stands and says whether it would load. That is the check to make after a definition has been edited by other means — a `doc_str_replace` here, a hand edit there — when one would rather hear about a stray comma now than at the moment of rolling.

**And for the character starting from a blank page, it will hand over the rulebook.** Called with `action: "schema"`, it touches no store at all and returns the whole definition format — the very JSON Schema the table judges every file against, every field and every comparison described — along with two worked specimens that between them exercise each feature the format has. A character asked to invent a tool from nothing need not guess at the shape of one; it may read the house rules first, write its definition, and save it in the ordinary way.

You may switch it off like any other tool, under **Pascal's Custom Tools** in the chat's tool settings, alongside `run_custom` itself.

## When something is wrong with a file

A tool that cannot be loaded is simply left out of the roster, and appears under **Would not read** at the foot of the run dialog's table, with a badge explaining why (click it to open the file on the Workbench in repair mode). It is never half-loaded and never guessed at. Common causes: the JSON doesn't parse; the last outcome isn't `true`; a `$param` names a parameter that doesn't exist, or one that isn't a number; an outcome asks after a parameter you never declared, or asks whether a string is greater than a number; the dice notation has a typo; two files in the same store claim the same name.

Misspelled keys are refused too, rather than ignored. A `when` containing `gt3` is not a `when` with an eccentric extra key in it; it is a comparison you meant to make and didn't, and had Quilltap shrugged and loaded the file, that outcome would have sat in your table for months looking like a branch that simply never comes up.

If a roll fails while it's actually running — a bound that ended up above its own ceiling, say — **Prospero** reports it, not Pascal. Pascal announces outcomes, and only outcomes. A roll that didn't happen doesn't get one.

## Limits

Sixty-four tools per scene, eight parameters and thirty-two outcomes per tool, eight trigger phrases per tool (three to eighty characters each) and four triggered tools per message, a thousand characters per message, five hundred per description, eighty per title. An oracle's prompt runs to four thousand characters and its error line to a thousand; its answer is trimmed to eight thousand before anything tests or prints it, unless the tool's own `maxOutput` says otherwise — anywhere from one character to a hundred thousand, with the call's token budget following along. If a scene somehow exceeds the roster limit, the surplus is dropped and said so out loud — never silently.

## Turning it off

The **Custom tools** setting on Settings → Chat governs the whole arrangement. Switched off, neither `run_custom` nor `edit_custom_tool` is offered to any model, the gutter button goes away, and no trigger phrase is listened for. Your files stay exactly where they are.

Trigger phrases have a switch of their own besides — **Auto-Run Custom Tools on Trigger Phrases**, under Settings → Chat → Automation, off unless you turn it on.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this setting:

`help_navigate(url: "/settings?tab=chat&section=custom-tools")`

## Related Settings

- **[Pascal's Workbench](pascals-workbench.md)** — the visual editor, library, and proving bench at `/custom-tools`.
- **Settings → Chat → Automation** — auto-detection of dice rolls (`2d6`, `3d6+2`) written plainly in a message.
- **The Scriptorium** — the document stores your `Tools/` folders live in.
