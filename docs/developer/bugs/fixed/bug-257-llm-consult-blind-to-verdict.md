# Bug 257 — a custom tool's LLM consult cannot see the verdict, so a prompt that asks it to compare reports the wrong result

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-20, live on `Friday` (chat `5abcec04-ab4a-4a8b-baf0-c79cfb09b200`), tool `entanglement_scan` ("Ansible-class Entanglement Scan") in Quilltap General |
| **Fixed** | 2026-10-20 |
| **Severity** | Medium. Nothing is stored wrongly and the engine's own roll record is correct, but the text the operator and the characters read contradicts the recorded outcome, and `revealOdds: false` hides the table, so nobody can tell which one to believe |
| **Who it bites** | anyone who writes a Pascal custom tool with an `llm` block whose prompt tells the model to decide between outcomes ("if {{roll}} >= {{params.x}} then report success, otherwise…"). The cheaper the consult model, the more often it happens |
| **Provenance** | Original to the LLM consult (Pascal custom tools). The consult has always run before the outcome table, so the prompt has never been able to see the outcome |
| **Fix site** | `lib/pascal/custom-tools.ts` (`executeCustomTool` run order, `PlaceholderSubjects.outcome`), `lib/pascal/placeholders.ts` (`outcome` family), `lib/pascal/custom-tool.types.ts` (`brief`, `validateOutcomeBriefs`, `outcomeTableTestsLlm`), `lib/pascal/tool-draft.ts` (draft field, prompt lint, brief audit), `components/custom-tools/OutcomesSection.tsx` / `ProvingBench.tsx`, `public/schemas/qtap-custom-tool.schema.json`, `help/custom-tools.md`, `help/pascals-workbench.md` |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-20).** The recommended "3a" was built, in a stronger shape than the entry
proposed, and the docs and lint came with it. An outcome row takes an optional `brief` (the
conclusion it means). When no row tests `llm`, `executeCustomTool` deals the table first and the
consult prompt may quote `{{outcome.brief}}`, `{{outcome.state}}` and `{{outcome.index}}`, so the
model is told the verdict instead of asked to derive it; messages, the chip label and effects read
the same placeholders. A table that tests `llm` keeps the old order, and the loader rejects
`{{outcome.*}}` in its prompt (and a `brief` that quotes `{{llm}}` / `{{outcome.*}}`, or sits on a
tool with no `llm` block). The Workbench gained a brief field, a warning on prompts that compare
numbers, a warning on rows without a brief when the prompt reads one, and an audit flag on
reachable rows without one. Tests: `__tests__/unit/lib/pascal/outcome-brief.test.ts`. Verified live
on V4test through the Workbench preview with a real cheap-model consult: 32 runs of the scanner
rewritten with briefs (95 layers and 0 layers) all read the verdict the table reached.

## Symptom

The operator wrote a tool whose report is supposed to say "definitely entangled" only when the roll
clears the number of entanglement layers, and "not definitively found" otherwise. Every run came back
"definitively confirmed", including the one that rolled 29 against 95 layers. The operator had
iterated on the prompt wording several times with no change, and suspected either that the model
cannot do the arithmetic or that the engine was misbehaving.

Neither quite. The engine did its arithmetic correctly and recorded the right outcome; the model was
asked to repeat the comparison, was handed both branches, and picked the wrong one.

### The run that triggered the report

Recorded in `chat_messages.pascalMeta` for the most recent `systemSender = 'pascal'` message of the
chat above (the database may not exist or may have changed; this is the relevant content,
abbreviated only where noted):

```
tool:           entanglement_scan  ("Ansible-class Entanglement Scan")
definitionTier: global  (Quilltap General)
params:         scan_target = "Tessarium shard"
                possible_partner = "Estate Ansible"
                difficulty_of_scan = 0
                num_layers = 95
rollForm:       dice   notation 1d100   raw 29   diceRolls [29]   value 29
state:          partial          outcomeIndex: 1      invokedBy: user
llm.provider:   NANOGPT          llm.model: deepseek/deepseek-v4.1-flash
```

The prompt the consult actually received (`llm.prompt`), after template rendering:

```
In a science-fiction world where quantum entanglement can be verified and measured, and the
partner can be discovered, deliver something that an AI would generate upon scanning Tessarium
shard for that entanglement with Estate Ansible.

**YOU MUST ACTUALLY DO THE MATH TO DECIDE WHETHER THIS IS ENTANGLED OR NOT.**

- **If 29 >= 95**, then report that there is definitely an entanglement with Estate Ansible with
  a very, very high degree of likelihood.
- Otherwise report that the entanglement was not definitively found. Leave room for observer
  interference.

Use technical terminology appropriate for something in the very near future that can read quantum
entanglement signatures in your reply. Do not indicate that this is fictional or based on a random
number or dice roll. Make up all the numbers you use to match the terminology you have chosen; do
not mention the actual numbers you got or are comparing against, except in a this pseudo-report at
the end in a separate paragraph:

`𝛀 = 0 | 𝛌 = 95 | 𝛘 = 29`
```

What the model returned (`llm.output`, sections 1–3 elided; they are generic Bell-test prose with an
S-value of 2.71, concurrence 0.83, fidelity 0.91, "99.7th percentile" registry match):

```
**QUANTUM ENTANGLEMENT VERIFICATION REPORT**
**Subject:** Tessarium Shard … **Reference Partner:** Estate Ansible …
…
**4. Conclusion**

The entanglement between the Tessarium shard and Estate Ansible is **definitively confirmed**
with a very, very high degree of likelihood. The correlation strength, Bell violation, and
registry phase-conjugate match jointly exclude classical or accidental coincidence at
overwhelming confidence. …

`𝛀 = 0 | 𝛌 = 95 | 𝛘 = 29`
```

The prompt rendered correctly (`29 >= 95` is spelled out), the model echoed the footer with 29 and 95
in it, and still concluded the opposite of the comparison it was shown.

### The tool definition at the time

`Tools/entanglement_scan.tool.json`, abbreviated to what matters:

```json
{
  "name": "entanglement_scan",
  "revealOdds": false,
  "roll": "1d100",
  "parameters": {
    "difficulty_of_scan": { "type": "number", "default": 50, "min": 0, "max": 100 },
    "num_layers":         { "type": "number", "default": 0,  "max": 100 }
  },
  "llm": {
    "prompt": "…**If {{roll}} >= {{params.num_layers}}**, then report … definitely an entanglement … Otherwise report that the entanglement was not definitively found…",
    "errorMessage": "Ansible connection to AI agent failed."
  },
  "effects": [ { "log": "Attempted scan for entanglements against {{params.scan_target}}, result:\n\n{{llm}}" } ],
  "outcomes": [
    { "when": { "gte": {"$param":"num_layers"}, "gt": {"$param":"difficulty_of_scan"} },
      "message": "{{llm}}", "state": "success" },
    { "when": { "gte": {"$param":"difficulty_of_scan"} },
      "message": "{{llm}}", "state": "partial" },
    { "when": true, "message": "Unable to scan, check velocity, proximity, hostility, shielding.", "state": "failure" }
  ]
}
```

## Root cause

Three things combine.

1. **The consult runs before the table and cannot see its result.**
   `lib/pascal/custom-tools.ts`, the run function around line 2010: the roll is drawn, then
   `renderTemplate(definition.llm.prompt, { value, roll, dice, params, character, metadata, progress,
   now, state, inventory })` is posed to the model, and only then does `pickOutcome` run. There is no
   `{{outcome}}`, `{{state}}` or verdict in the prompt's subjects (the comment at line 2010 says so on
   purpose: the table may test the consult's answer, so the answer cannot depend on the table). The
   author who wants the report to follow the roll has two choices: let the model re-derive the verdict
   from the numbers, or not let it write the verdict at all. The documentation steers toward the first
   (the oracle examples in `help/custom-tools.md` all let the model judge).

2. **Both branches are in the prompt.** A small model is given the "success" report and the "failure"
   report as alternatives, plus an opening line ("deliver something an AI would generate upon
   scanning X for that entanglement") that frames the task as producing a positive finding, plus an
   instruction not to mention the numbers and to invent plausible ones. That is a prompt that rewards
   writing a persuasive confirmation. Numeric comparison of two integers in the middle of a creative
   writing task is something the cheap utility model (here `deepseek-v4.1-flash`) gets wrong often;
   rewording the prompt doesn't change the structure that makes it likely.

3. **The table and the prompt disagree, and neither is authoritative to the reader.** The prompt
   says success is `roll >= num_layers`. The table says success is `roll >= num_layers` **and**
   `roll > difficulty_of_scan`, and its second row (`partial`) matches anything that clears
   `difficulty_of_scan` regardless of `num_layers`. With `difficulty_of_scan = 0` and `roll = 29`, the
   table (correctly, per its own rules) lands on `partial`; the prompt's rule, if the model had
   followed it, says "not definitive" as well, but nothing guarantees the two agree for other
   parameters (high difficulty, low layers). Both outcome rows carry the same `message: "{{llm}}"`, so
   the player cannot distinguish them, and `revealOdds: false` hides the table from characters. The
   `partial` and `success` states are only visible in the roll record, which the Salon body doesn't
   show.

Not a cause, checked: the engine's roll, parameter clamping, placeholder substitution and outcome
selection were all correct on this run (`raw` 29, `{{roll}}`/`{{params.num_layers}}` rendered as
`29`/`95`, `state: partial`, `outcomeIndex: 1`). The log effect wrote `{{llm}}` verbatim, as designed.

## Why it survived

The consult is documented as an oracle for *judgment* ("does the doorman wave it through?"), where
the model's answer is the verdict and the table reads it back. This tool uses it as a *narrator* for a
verdict the table computes, which the docs never describe, and nothing in the Workbench warns about it.
The Workbench's "ask it live" and scripted-answer test paths exercise the table against a scripted
`{{llm}}`, not the case "the model's text contradicts the table", and the audit never asks the oracle
live. The mismatch is only visible by reading the rendered prompt against the recorded state, which
is what the operator did here.

## Suggested fix

Presented in order of preference; the first is a tool-definition change that works today and doubles
as the recommended pattern for the docs, the second and third are engine changes.

### 1. Docs and the Workbench steer authors to "model narrates, table decides"

Make the table the only place a threshold is compared and keep the verdict out of the model's hands:

- The consult prompt asks for the **neutral body** only ("describe the acquisition and raw signal
  analysis… do **not** state a conclusion or verdict… end with the line `𝛀 = … | 𝛌 = … | 𝛘 = …`").
- Each outcome's `message` is `{{llm}}` followed by that outcome's own static conclusion:

  ```json
  { "when": { …success… }, "message": "{{llm}}\n\n**Conclusion:** entanglement with {{params.possible_partner}} is definitively confirmed, at very high confidence.", "state": "success" },
  { "when": { …partial… }, "message": "{{llm}}\n\n**Conclusion:** entanglement not definitively found; observer interference cannot be excluded.", "state": "partial" }
  ```

- The `log` effect repeats the conclusion if the log should carry it (it receives only `{{llm}}`).
- Add a section to `help/custom-tools.md` under *Asking an oracle* ("When the table, not the oracle,
  decides") with this pattern and the reason: a prompt that says "if {{roll}} >= X then…" asks a cheap
  model to redo arithmetic the engine has already done. Mention it in `help/pascals-workbench.md`
  beside the oracle description. Both need their `url` frontmatter and In-Chat Navigation sections to
  stay valid.
- Fix the example tool in Friday (not a repo change): rewrite `entanglement_scan.tool.json` as above,
  and decide whether success should also require `roll > difficulty_of_scan` or whether
  `difficulty_of_scan` is meant to be a floor for a partial reading only.

### 2. A Workbench lint for a prompt that compares

A static warning (the Workbench already raises eyebrows for typo'd placeholders and for trigger
phrases quoted in messages) when the `llm.prompt` contains a comparison between two placeholders —
`{{roll}}`/`{{value}}`/`{{params.…}}`/`{{state.…}}` on both sides of `>=`, `<=`, `>`, `<`, `==` — or the
phrases "do the math" / "if … then report". Wording: the table can decide this for you; let the
oracle narrate. Cheap and non-blocking.

### 3. (Optional, larger) Let the prompt see a verdict decided without the oracle

Two shapes, pick one or neither:

- **Pre-consult outcome.** When no outcome row tests `llm`, the table could be evaluated first and
  `{{outcome}}` / `{{outcomeState}}` (e.g. `success`, `partial`) offered in the prompt and the log.
  Run order is unchanged when any row tests `llm`, because then the table needs the consult first;
  `{{outcome}}` would simply be unavailable (and flagged) in that case. This is a small change to the
  run order at `custom-tools.ts:2010` plus `OutcomeSubjects` and the placeholder docs, and it makes the
  prompt `…the scan {{outcomeState}}; write a report that agrees` possible. Two things to settle: what
  `{{outcome}}` is for a table that tests `llm` (declined, as `{{llm}}` is declined in the prompt
  today), and whether the audit's "deal a thousand hands" needs to know.
- **Per-outcome prompts.** Move the consult onto the outcome row (`outcomes[].llm`) so each branch
  has its own prompt and the model never sees the other branch. More surface and a new schema field,
  a new export/backup field check, and the schema mirror at
  `public/schemas/qtap-custom-tool.schema.json`; probably more than this problem warrants.

Recommendation: do 1 and 2 first (docs plus a lint, no engine change); do 3a only if a second report
of the same shape turns up.

## Considerations if the engine changes

- `lib/pascal/custom-tool.types.ts` is the Zod source of truth for the `llm` block; any schema change
  must be mirrored in `public/schemas/qtap-custom-tool.schema.json` and the tool-draft / vocabulary
  modules (`lib/pascal/tool-draft.ts`, `tool-vocabulary.ts`) that tell models and the Workbench which
  placeholders exist.
- `pascalMeta` records `llm.prompt` and `state`; a new `{{outcome}}` placeholder needs no new column
  (the JSON column absorbs it) but `docs/developer/DDL.md`'s `pascalMeta` description should mention it
  if the recorded shape grows.
- Custom tools travel in `.qtap` exports and backups as files in stores, so a placeholder addition is
  backward-compatible; a renamed one is not.

## How to verify

1. Rewrite the Friday tool as in suggestion 1, run it with `difficulty_of_scan = 0`, `num_layers = 95`
   a dozen times. Every run that rolls below 95 must read "not definitively found"; every run at or
   above must read "definitively confirmed"; and the Salon text must agree with `pascalMeta.state`
   every time.
2. Same tool, `num_layers = 0`: every run is `success` and reads as confirmed.
3. Workbench: a prompt containing `{{roll}} >= {{params.num_layers}}` shows the new warning; the
   rewritten prompt does not.
4. If suggestion 3a is built: a unit test in `__tests__/unit/lib/pascal/` that a definition with no
   `llm`-testing rows renders `{{outcomeState}}` in its prompt, and that one with an `llm`-testing row
   leaves it unresolved and flagged.
