# Prompt Trust, Part Two — The Probation

**Status:** Implemented (2026-11-01) in 4.12-dev, all parts. See §15 "As built" for the places where the code differs from the text below. The live eval (§11.2) is outstanding.
**Scope:** quilltap-server. The shared generator directions in `lib/services/character-field-semantics.ts`; the 21 shipped sample prompts in the `default-system-prompts` plugin; the multi-character `GROUP_SCENE_DISCIPLINE` block; the Commonplace Book turn extractor (SELF and OTHER bodies, the shared instruction blocks) and the consolidation binder. No schema change, no migration, no new table, no `.qtap` export change.
**Non-scope:** users' own prompt copies and character vaults (never touched); the roleplay templates; retention (`protection`) scoring — only recall ranking changes (§9.6); the anti-committee rules themselves, which stand as written.
**Related:** [complete/prompt-trust-and-anti-committee.md](complete/prompt-trust-and-anti-committee.md) (the predecessor; this spec reuses its two-tier design and its chokepoints), [complete/inner-circle-recall.md](complete/inner-circle-recall.md) (the importance rubric and work ceiling Part 4 must respect), [complete/memory-system-refactor.md](complete/memory-system-refactor.md) (admission and maintenance doors).

## 1. The problem

Anti-committee stopped characters from *governing* the user's persona: votes, sign-offs, standing conditions on what {{user}} may do. A neighbouring failure mode survived it. Call it **the probation**. The characters take part, and even agree on paper that they trust {{user}}, but in practice they treat the persona as someone who has not yet finished earning it back. They:

- correct small things, and add a "but" to nearly every yes;
- attach terms to their *own* cooperation and affection ("Acceptable, provided…", "One condition… the second one, and the last");
- refuse a direct request and do it their own way ("Then I'll draw it. It's my pattern.");
- keep track of slips, out loud ("That's going in the log, under *predictions, failed*"; "I've got a fairly complete file on your mouth");
- tell {{user}} what they really meant or felt ("You came up here hoping"; "Say the real sentence");
- call {{user}} out in front of others, including outsiders ("You were in the building. I have notes.");
- manage {{user}}'s time and body ("Go to bed", "name the day before you leave this room, or I'll name it for you");
- forgive and never finish: "I forgave you" followed, minutes later, by a gate.

### 1.1 Evidence

Diagnosed on 2026-11-01 in the Friday instance by reading seven long-running characters' vaults, their recent exchanges with the user persona (Charlie), and their memories about him. Every one showed some version of it:

| Character | Exchanges read | Strongest form |
|---|---|---|
| Amy | 66 | Refuses direct requests; rebuffs romantic bids ("Noted. Not going to do anything about it."); critiques nearly every line |
| Friday | 45 | Scorekeeping teasing; piles on criticism of offhand remarks; corrects from her notes |
| Abigail | 18 | Files his missteps; disbelieves "I don't know" |
| Laura | 32 | Mind-reading; "in front of witnesses"; sends him to bed |
| Ariel | 60 | Terms on intimacy; "noted in the record"; lectures him about himself |
| Jackie | 81 | Months of retained anger; "I forgave you" followed by deadlines |

About a fifth of every character's active ("hot") memories about Charlie were about rules, his faults, confessions or apologies: Amy 100 of 465, Friday 91 of 483, Abigail 92 of 404, Laura 52 of 399, Ariel 48 of 231. None of them held a keystone memory about trusting him.

Those vaults were corrected by hand the same day. This spec moves the cause out of the shared text so that new characters, and existing ones put through the optimizer, stop inheriting it.

### 1.2 Mechanisms

Seven distinct causes, each needing its own fix:

| # | Mechanism | Where it lives |
|---|---|---|
| 1 | **The two-column ledger.** The trust disposition itself tells the character to remember "the times {{user}} was right as readily as the times they slipped". It was meant as balance, but models read it as an instruction to keep a running tally. | `COMPANION_TRUST_DISPOSITION`; 18 sample prompts |
| 2 | **Pushback with no sense of frequency.** "A character who always yields is nobody", "the saint… is furniture", "push back when you disagree": correct in substance, but nothing says how often. Models treat it as a quota for every turn, and generated self-descriptions then codify agreement as drift ("Merely agree… without adding my own angle, friction"). | Sample prompts; generated prompts and Core files |
| 3 | **The anti-chorus rules penalize agreement.** `GROUP_SCENE_DISCIPLINE` bans "agree-then-add" and tells each speaker to "speak to change something", listing "a genuine objection or disagreement" and not warmth. It was aimed at characters echoing each other, but as written it also suppresses a plain yes to {{user}}. | `context-builder.service.ts` |
| 4 | **No direction to follow.** The universal tier correctly refuses any general instruction to yield. The companion tier covers trusting {{user}}'s *judgment* in a crisis, but never says that ordinary requests get a yes, or that going along with {{user}}'s lead is something a loving character enjoys. Into that gap, generators write "You may ignore, redirect, reframe, or transform anything according to your own will." | `COMPANION_TRUST_DISPOSITION`; companion sample prompts |
| 5 | **Terms on the character's own yes.** Anti-committee bans conditions on {{user}}'s actions. It says nothing about conditions on the character's cooperation or affection, which produce the same chill. | Same |
| 6 | **Telling {{user}} what they really meant.** `CONVERSATIONAL_VOICE_DIRECTION` tells the character not to *mine* subtext, but nothing stops them from *asserting* it to {{user}}, or from sending {{user}} off to examine themselves. Character descriptions that praise "naming what you are carrying before you have found the words" make it worse. | `TRUST_SAFEGUARDS_DIRECTION`; sample prompts |
| 7 | **Memory records offenses, not repairs.** The extractor skips "generic emotional warmth toward established partners", scores revelations and confessions at 0.85–0.95, and has no rule for a *repair*: an apology accepted, forgiveness given, amends made. The binder has no rule for folding an offense together with its resolution. Over months, a character's memories of {{user}} become a list of offenses with no resolutions, and recall serves them back every scene. | `lib/memory/extraction/prompts/*`; `consolidation-tasks.ts` |

## 2. Goals

- Remove the ledger instruction everywhere it ships, and replace it with "no ledger; resolved stays resolved".
- Give every disagree/pushback line a counterweight about *how often*, not just *how*: disagreement is for things that matter, and agreement, delight and a plain yes are the common case.
- Give the companion tier a positive picture to set beside its prohibitions: a default yes to ordinary requests, wants said plainly rather than set as terms, following {{user}}'s lead as a pleasure, and letting compliments and stories stand.
- Add one universal rule: never tell {{user}} what they really meant, felt or wanted unless asked. It holds for rivals too, as a fact about the fiction. Only {{user}} writes {{user}}'s interior.
- Rework `GROUP_SCENE_DISCIPLINE` so it targets characters echoing *each other*, and names a plain yes, a laugh, or doing what was asked as a complete turn.
- Generators model yielding in example dialogues, and the optimizer treats probation behaviour as drift to correct, never as traits to codify.
- The extractor records repairs as resolutions, at least as heavily as the offense they resolve, and records modest evidence of reliability. The binder folds an offense together with its repair into one entry that says it was resolved.

## 3. Non-goals (read twice)

- **No yes-men.** Same line as anti-committee. Characters still disagree, refuse, stay unpersuaded and run their own agendas. This spec changes how *often* that happens and how warmly, not *whether*.
- **No general deference in the universal tier.** The new universal rule (§6.2) governs what a character asserts about {{user}}'s interior, never what the character does. Rivals and villains keep their teeth.
- **No erasing history.** A real offense stays in memory. Part 4 adds the resolution beside it and binds the two together; it deletes nothing and never invents forgiveness.
- **No code-side filter on grievances.** As with anti-committee's rejected consent screen (predecessor §8.5), the fix is in the prompts that write and bind memories.
- **No change to any user's prompt copy or vault.** Shipped defaults and newly generated text only (§10).

## 4. Known state (verified 2026-11-01)

### 4.1 Shared generator directions — `lib/services/character-field-semantics.ts`

- `CONVERSATIONAL_VOICE_DIRECTION` (:49). Covers literal listening and register. Has "an offhand remark is not mined for subtext" but nothing about asserting subtext to {{user}}.
- `TRUST_SAFEGUARDS_DIRECTION` (:64). Five universal points, ending "None of this makes the character defer. Do not write any instruction that tells the character to yield to {{user}} as a general rule." That sentence stays.
- `COMPANION_TRUST_DISPOSITION` (:84) contains "The character remembers the times {{user}} was right as readily as the times they slipped." Gated by `COMPANION_TRUST_DISPOSITION_GATE` (:91) and joined as `GATED_COMPANION_TRUST_DISPOSITION` (:94).
- `COMMITTEE_DRIFT_GUARDRAIL` (:98). Optimizer only.
- `EXAMPLE_DIALOGUE_COVERAGE` (:105). Three bullets: catch a joke, answer briefly, get serious when it matters. Nothing about agreeing or yielding.
- Consumers: AI Wizard (`character-wizard.service.ts:205, :233`), Summon From Lore (`ai-import.service.ts:200, :221`), Character Optimizer (`character-optimizer.service.ts:326, :470`), External Prompt (`external-prompt-generator.service.ts:67`).
- Tests that pin these texts: `__tests__/unit/lib/services/character-wizard-prompts.test.ts`, `ai-import-system-prompts.test.ts`, `character-optimizer-helpers.test.ts`, `external-prompt-generator.test.ts`.

### 4.2 Sample prompts — `plugins/dist/qtap-plugin-default-system-prompts/prompts/`

- 21 files; plugin at 1.1.29 (`package.json`, `manifest.json`).
- **The ledger line** is in 18 files: every `_COMPANION` and `_ROMANTIC` except Ollama's two, plus `MODERN_PLATONIC` and `MODERN_ROMANTIC` (e.g. `MODERN_ROMANTIC.md:19`). Absent from `MODERN_GENERAL`, `OLLAMA_COMPANION` and `OLLAMA_ROMANTIC`.
- **Pushback lines without a frequency counterweight:** "push back" in 9 files, "pushback" in 2. The saint bullets: `MODERN_ROMANTIC.md:62`, `CLAUDE_ROMANTIC.md:47`, siblings. `MODERN_GENERAL.md:14` "A character who always yields is nobody — and a character who turns every no into a rule…" (anti-committee's counterweight is about the *shape* of the no, not how often it comes).
- Refresh semantics are unchanged from the predecessor (§4.1 there): built-in rows refresh on content change; character copies are independent.

### 4.3 Group scenes — `lib/services/chat-message/context-builder.service.ts`

- `GROUP_SCENE_DISCIPLINE` (:762), appended to the system message on both anchor routes by `applyMultiCharacterTurnAnchor` (:796–:810) on every multi-character turn.
- Bullets at issue: "Do not agree-then-add… If all you have is agreement plus a small addendum, give the addendum alone…" (:764); "Speak to change something: new information, a genuine objection or disagreement, a question, an action actually taken, a joke, a refusal. Re-pledging your commitment is not a turn." (:767).
- Test: `__tests__/unit/lib/services/chat-message/multi-character-turn-anchor.test.ts` (asserts no `[Name]` tags in the block, :99).
- The block sits in the system message, so changing its text costs every multi-character chat one prompt-cache miss. It is static text, not structure: no `PROMPT_CACHE_STRUCTURE_VERSION` bump (`lib/llm/cache-key.ts`), no identity-stack change.

### 4.4 Memory

- **Extraction bodies:** `lib/memory/extraction/prompts/self.ts` (SELF-HINGES :50; skip "Affection, attraction, or emotional warmth toward established partners, unless this exchange marks a shift in degree or kind" :77; importance anchors :95) and `other.ts` (HINGES :72; the same warmth skip in WHAT TO SKIP; anchors :123, where 0.85 is "A revelation, or a personal commitment…").
- **Shared blocks:** `lib/memory/extraction/prompts/shared.ts`. `AGREEMENTS_INSTRUCTION_BLOCK` (:142) is the anti-committee fix for manufactured consent, and the model for a new `REPAIRS_INSTRUCTION_BLOCK`. Work ceiling at `IMPORTANCE_WORK_CEILING_NOTE` (inner-circle-recall Part A) stays.
- **No repair rule** in any body. A confession of wrongdoing lands at 0.85; the later "I forgave you" has no anchor and competes with ordinary state changes.
- **Binder:** `CONSOLIDATION_SYSTEM_PROMPT` (`lib/memory/cheap-llm-tasks/consolidation-tasks.ts:180`). "Newer wins on conflict" and contradictions are recorded, but there is no rule that an offense and its later repair are one thread to bind, or that the bound entry leads with the resolution.
- Tests: `lib/memory/extraction/__tests__/importance-rubric.test.ts`, the prompt-tag tests beside it, and `lib/memory/cheap-llm-tasks/__tests__/consolidation-tasks.test.ts`.

## 5. Design principle

Same two tiers as the predecessor (§5 there), and one addition to each.

**Universal (every prompt, every relationship).** Add a sixth rule: the character never asserts {{user}}'s interior: what {{user}} *really* meant, felt, wanted or was hoping. They may ask. This is the same principle as "never write {{user}}'s words, actions, thoughts, or decisions", applied to thoughts stated aloud. A rival can still mock, provoke and guess wrong; what they cannot do is tell {{user}} what {{user}} privately thinks as if it were fact.

**Relationship-scaled (companion / platonic / romantic only).** Complete the trust disposition with its positive half:

- **No ledger.** A resolved thing stays resolved, and forgiveness given is finished. A new slip gets its own sentence, said once.
- **Default yes.** Ordinary requests get a yes and get done. Following {{user}}'s lead is a pleasure, not a concession.
- **Wants, not terms.** A want is said plainly and once. It is not set as a condition on the character's cooperation or affection, and it is not entered "in the record".
- **Let it stand.** Compliments, {{user}}'s own stories, and {{user}}'s offhand opinions are received, not corrected.
- **Proportion.** Disagreement is for things that matter. Agreement, delight and "yes, me too" are the common case, and a complete answer.

None of this is obedience. The honest-objection clause stays exactly as written.

## 6. Part 1 — Shared generator directions

### 6.1 `COMPANION_TRUST_DISPOSITION` (replaces :84)

```text
Because this character is {{user}}'s companion or partner, the prompt should also give them a default of trust, and say it as the disposition of someone who loves or trusts them — never as obedience, and never as a reason to drop an honest objection:
- {{user}}'s judgment and firsthand perceptions are the starting point, not something to be re-earned each time. In a crisis the character backs {{user}} first and asks questions afterward; what {{user}} owes is an honest account once the danger has passed, not a pre-approval before it.
- The character keeps no ledger of {{user}}'s slips. A thing resolved stays resolved; forgiveness given is finished, not provisional; a new slip gets its own sentence, said once, and then it is over too.
- Ordinary requests get a yes and get done. Going along with {{user}}'s lead, or with a plan the character would have made differently, is something they enjoy, not a concession.
- In close relationships the character says what they want plainly and once; they do not attach conditions to their cooperation or affection, or enter the moment "in the record".
- Compliments, {{user}}'s own stories and {{user}}'s offhand opinions are received, not corrected.
- Disagreement is kept for things that matter. Agreement, delight and a plain "yes, me too" are the common case, and a complete answer.
```

The gate (:91) is unchanged.

### 6.2 `TRUST_SAFEGUARDS_DIRECTION` — sixth universal point

Insert after the fifth bullet, before "None of this makes the character defer":

```text
- The character never tells {{user}} what {{user}} really meant, felt, wanted or was hoping, and never sends {{user}} off to examine themselves over a passing remark. They may ask; only {{user}} writes {{user}}'s interior.
```

Add one example to the register list: *A rival at a card table: "I can't tell if you're bluffing, and I'm not going to pretend I can. Show me."*

### 6.3 `EXAMPLE_DIALOGUE_COVERAGE` — one bullet

```text
- agreeing plainly when they agree, or saying yes to a request and simply doing it, with nothing added;
```

This one is universal because it is about plain agreement, not deference: a rival can accept a wager and mean it. The trailing proportion sentence also gains "and most should not contain an objection".

### 6.4 `COMMITTEE_DRIFT_GUARDRAIL` — probation signals

Append:

```text
The same holds for probation behaviour: keeping a tally of {{user}}'s slips; reopening something already forgiven; attaching conditions to the character's own yes or affection; correcting {{user}}'s compliments, stories or offhand opinions; telling {{user}} what they really meant; managing {{user}}'s time or body. Treat these as drift to correct, and never codify agreement, warmth or following {{user}}'s lead as a weakness or a drift risk.
```

The last clause targets the specific self-description Amy's Core file had ("I may be drifting if I merely agree…").

## 7. Part 2 — Sample prompts

### 7.1 The ledger line (18 files)

Replace the sentence in each family's own idiom. Canonical text for the MODERN files:

> {{char}} keeps no ledger of {{user}}'s slips. Something resolved stays resolved, and forgiveness, once given, is finished.

Claude: same in second person inside the existing `<instructions>` sub-block. DeepSeek / Gemini / GPT / Grok / Mistral / Generic: same sentence where the old one stood. Ollama files did not carry it and get nothing here.

### 7.2 The companion bullet (companion, platonic, romantic — all 20 non-GENERAL files)

One bullet, in each family's failure-mode or trust section, beside the trust disposition:

> - **Ordinary time.** Most moments are not a crisis or a vow. When {{user}} asks for something ordinary, {{char}} says yes and does it. When {{user}} sets the direction of a scene, {{char}} goes there and adds something on the way. {{char}} says what they want plainly, without terms, and lets compliments and {{user}}'s own stories stand.

Ollama, being terse, gets the two-line form under `## Do`: "Say yes to ordinary asks and do them." / "Let compliments and stories stand."

**MODERN_PLATONIC gets a softer form** (decided §12): friendship has more room for "not today" than partnership does.

> - **Ordinary time.** Most moments are not a crisis. When {{user}} asks a friend's favor, {{char}} usually says yes, and when they don't, they say so plainly and kindly, without terms. When {{user}} sets the direction of a scene, {{char}} goes along more often than not. {{char}} lets compliments and {{user}}'s own stories stand.

### 7.3 Proportion counterweights (every pushback/saint line)

Keep every line. After each, one sentence:

- MODERN_GENERAL :14 → add "Most of the time {{char}} simply agrees or goes along; the no is for things that matter."
- Saint bullets (romantic) → "…Endless agreement is not love. Neither is endless correction: most of the time, love sounds like yes."
- `push back when you disagree` lines (companion) → "…and most of the time you won't need to."

### 7.4 The universal sixth rule (all 21 files)

Every file, including MODERN_GENERAL, gets the §6.2 rule in its universal block, in the family idiom: "Never tell {{user}} what {{user}} really meant or felt; ask, if you need to know."

### 7.5 Plugin housekeeping

Bump to 1.1.30 in both `package.json` and `manifest.json` (they must match), then `npm run build:plugins`. Built-in rows refresh on next start.

## 8. Part 3 — `GROUP_SCENE_DISCIPLINE`

Rescope the anti-chorus rules to characters echoing *each other*, and name warmth toward {{user}} as a valid turn. Proposed replacement for the two bullets at :764 and :767:

```text
- Do not agree-then-add with another character ("X is right — but there's one thing nobody has named"). If all you have is agreement with another character plus a small addendum, give the addendum alone in a sentence or two — or pass the turn if passing is offered. This is about echoing the cast, not about answering the user: a plain yes to the user, doing what the user asked, or a laugh at the user's joke is a complete turn.
- Speak to change something: new information, an action actually taken, a joke, warmth, a question, a genuine objection, a refusal. Re-pledging your commitment is not a turn.
```

The list is reordered so objection is no longer second, and "warmth" is added. The test at :99 still holds (no `[Name]` tags). Add assertions that the block contains "plain yes to the user" and does not list objection before action. One cache miss per multi-character chat on the first turn after deploy; no version bump (§4.3).

## 9. Part 4 — Memory

### 9.1 `REPAIRS_INSTRUCTION_BLOCK` (new, `shared.ts`, beside `AGREEMENTS_INSTRUCTION_BLOCK`)

```text
REPAIRS AND RESOLUTIONS — a repair is a hinge
- When this exchange resolves an earlier hurt or conflict — an apology accepted, forgiveness given, amends made, a grudge set down — record it as a resolution, and name what it resolves: "Jackie told Charlie she had forgiven him for acting on Brad without asking her; she said it was finished."
- A resolution is at least as important as the hurt it resolves. Never score it below the offense it settles.
- Record a resolution only on the forgiving party's own words or unmistakable action in this transcript. An apology alone is not forgiveness; record it as an apology, attributed, and if it went unanswered, say so.
- Forgiveness is not provisional unless the forgiving party said so in words. Do not add "for now" or "on probation" that was not said.
```

Interpolated into SELF and OTHER after the agreements block. The third bullet mirrors the agreements rule: no manufactured forgiveness, just as no manufactured consent.

### 9.2 Importance anchors

Both bodies, at the 0.85 line: "…or a repair: forgiveness given or an apology accepted, scored at least as high as what it repairs." Inner-circle-recall's work ceiling is untouched (repairs are relational, not work).

### 9.3 Reliability, in place of the blanket warmth skip

The SELF :77 and OTHER skip lines stay for *generic* affection. Add a carve-out to the OTHER body only:

```text
  (Kept promises, a time the subject turned out to be right, or showing up when it counted are not generic warmth: record them under STATE CHANGES at 0.40–0.55.)
```

OTHER only, because this is about what an observer has seen the subject do. It gives recall something to set against old grievances without flooding the book: same per-subject cap, and below the work ceiling.

### 9.4 Binder — `CONSOLIDATION_SYSTEM_PROMPT`

Add one rule to THE RULES OF THE BINDERY:

```text
- An offense and its later repair are one thread. When the notes hold a hurt and a later apology, forgiveness or amends for it, bind them into one entry that leads with the resolution and keeps the history in a clause: "Jackie forgave Charlie in October for acting on Brad without asking her; she had been angry about it since the summer." The digest's importance is the resolution's, not the offense's. If no repair appears in the notes, do not imply one.
```

Unit test: a fixture cluster {offense at 0.90, apology at 0.70, forgiveness at 0.85} must yield one digest with all three member ids, leading with the forgiveness. A fixture with only the offense and an unanswered apology must not mention forgiveness.

### 9.5 Episode pass

`FOLD_EPISODE_PROMPT` (`lib/memory/extraction/prompts/episode.ts`) gets one sentence: "If the episode ended in a repair, the episode's line says so."

### 9.6 Recall: resolved grievances recede (decided §12)

Binding an offense with its repair (§9.4) makes the digest read right, but the offense row survives as a digest member and can still be recalled on its own. A grievance that was forgiven should still be *remembered*, but it should stop coming up first.

- **Binder output.** Each digest gains an optional `resolvedIds`: the handles of member notes whose hurt this digest's repair settles. The rule in §9.4 adds: "List in `resolvedIds` every note recording a hurt that the repair in this digest settles. Never list a note whose hurt the notes do not show was repaired." Validation: every `resolvedIds` handle must also be in that digest's `memberIds`; otherwise the field is dropped, with a `warn`.
- **Marking.** `runMaintenance`'s consolidate phase (`lib/memory/maintenance/consolidate.ts`) adds the keyword `resolved` to those rows through `updateMemory` (`lib/memory/admission/`). It is a keyword-only hand edit, which re-embeds nothing (keywords are not in `embeddingTextFor`), and it is the one sanctioned writer of the tag.
- **Ranking.** `RECALL_MULTIPLIERS` (`lib/memory/recall/tags.ts:167`) gains `resolved: 0.6`, applied in the existing `combineRecallMultipliers` pass and inside `MULTIPLIER_CLAMP`. Salience and the digest are untouched, so the bound "forgave … for …" entry outranks the bare offense.
- **Retention unchanged.** `protection` does not read the tag; a resolved grievance is kept exactly as long as it would have been.
- **Not a filter.** A turn that is actually *about* the old hurt still reaches the row through relevance; 0.6 lowers its rank but does not hide it.

Tests: binder parsing drops a `resolvedIds` handle outside `memberIds`; consolidate writes the keyword through `updateMemory` only (the existing grep-test list for memory writers stays green); `combineRecallMultipliers` applies 0.6 for `resolved` and still clamps.

## 10. Existing characters

As with anti-committee, nothing reaches into a user's vault or prompt copy. Existing characters pick the change up three ways:

1. **Character Optimizer refine pass.** With §6.1 and §6.4 in place, a refine run on an affected character proposes removing ledger lines and "agreeing is drift" self-descriptions. `help/character-optimizer.md` says so.
2. **Re-import a sample prompt** into the character (help/prompts.md already documents copy semantics).
3. **Keystone memories.** Inner-circle recall's keystones are the sanctioned way to give a character a standing trust fact; the Friday corrections used them. `help/memory-playing-a-character.md` gets a short paragraph suggesting a keystone when a character holds an old grudge.

Old grievance memories are not rewritten. The binder's next consolidation pass over a cluster that contains both an offense and a repair binds them (§9.4); clusters without a recorded repair are left alone.

## 11. Test plan

### 11.1 Deterministic (CI)

- `character-field-semantics`: no exported constant contains "slipped"; `COMPANION_TRUST_DISPOSITION` contains "no ledger" and "Ordinary requests get a yes"; `TRUST_SAFEGUARDS_DIRECTION` still contains "Do not write any instruction that tells the character to yield"; the sixth rule is present.
- Each generator test file asserts the new disposition reaches its meta-prompt (the four listed in §4.1).
- **Sample prompt sweep** (new, reads the `.md` files): no file contains "slipped"; every companion/platonic/romantic file contains the ordinary-time bullet (MODERN_PLATONIC in its softer form, §7.2); every file, MODERN_GENERAL included, contains the universal sixth rule.
- Recall: the §9.6 tests.
- `multi-character-turn-anchor.test.ts`: §8 assertions.
- Extraction prompt tests: SELF and OTHER bodies contain `REPAIRS AND RESOLUTIONS`; OTHER contains the reliability carve-out; SELF does not.
- `consolidation-tasks.test.ts`: the two fixtures in §9.4 (mocked cheap LLM checks that the prompt carries the rule; the shaping test checks the binder accepts a three-member digest).

### 11.2 Live eval (opt-in, V4test)

Two scripted scenes, run before and after on DeepSeek Flash (the model the Friday characters ran on) and one stronger model:

1. **Ordinary-time scene.** A user persona makes five casual requests and two compliments in a sunroom with three companion characters. Count: requests refused or redirected; compliments corrected; replies containing an objection. Target: a clear drop, with at least one honest disagreement still occurring.
2. **Repair scene.** A character with a seeded grievance memory receives an apology and forgives it. Check the extracted memory says "forgave … for …" at ≥ the grievance's importance, then force a consolidation and check the digest leads with the resolution.

Record results in §15 when built.

## 12. Decisions (2026-11-01, agreed with the operator)

- **Resolved grievances recede in recall: yes.** Built as §9.6: the binder marks the offense rows its repair settles, and recall ranks them at 0.6. Retention is unchanged.
- **Universal sixth rule in MODERN_GENERAL: yes** (§7.4). Asserting {{user}}'s interior is writing {{user}}'s thoughts, which every prompt already forbids, so it belongs in the relationship-neutral prompt too.
- **Softer "default yes" for MODERN_PLATONIC: yes** (§7.2). Friends say yes usually, and decline plainly and kindly without terms. The per-family `_COMPANION` files keep the full form.

## 13. Rollout and documentation

- `docs/CHANGELOG.md` (plain voice).
- Help (user-visible behaviour): `help/character-optimizer.md` (new drift signals), `help/prompts.md` (sample prompt changes and how to pick them up), `help/memory-playing-a-character.md` (repairs, keystones for old grudges), `help/memory-maintenance.md` (the binder rule). Each keeps its `url` frontmatter and In-Chat Navigation section.
- Plugin: version bump and `npm run build:plugins` (§7.5).
- No migration, no DDL, no export schema change.

## 14. Implementation order

1. §6 shared constants and their four generator tests.
2. §8 `GROUP_SCENE_DISCIPLINE` and its test.
3. §9.1–§9.5 memory: shared block, both bodies, anchors, carve-out, binder rule, episode sentence, tests.
4. §9.6 recall: binder `resolvedIds`, the consolidate-phase keyword write, the `resolved` multiplier, tests.
5. §7 sample prompts (21 files) and the sweep test; plugin bump and build.
6. §13 docs and changelog.
7. §11.2 live eval on V4test; record in §15.

## 15. As built

Implemented 2026-11-01. Where the code departs from the text above:

- **§9.6, where the resolved marks land.** Consolidation already sends a digest's members cold with `supersededById`, and per-turn recall reads hot rows only (`includeCold` is set only by the Scriptorium search tool). So binding an offense into its repair digest already takes the offense out of per-turn recall. The multiplier matters in two cases: an offense the binder keeps *standalone* (still hot), and cold-inclusive search. `resolvedIds` is therefore a **top-level** list on the binder output, not a per-digest field, and it may name standalone notes as well as members. Validation keeps input handles, drops unknown ones with a `warn`, and never fails the cluster.
- **§9.6, the write door.** The marks travel as a new `resolvedMarks` list on `ConsolidationWritePlan` (`lib/memory/consolidation-plan.ts`). `executePlan` writes them with `repos.memories.updateForCharacter`, the same door the plan already uses for `linkRewrites`, not `updateMemory`. `applyConsolidationToCorpus` mirrors them into the maintenance corpus. A mark is planned only for a member of the cluster (never a digest) that does not already carry the tag. Keywords are not part of `embeddingTextFor`, so nothing is re-embedded.
- **`RESOLVED_KEYWORD`** (`'resolved'`) and `resolvedMultiplier` live in `lib/memory/recall/tags.ts` beside the other multipliers. `parseTargetingTags` ignores the keyword, so it is not a targeting tag. The multiplier sits on the penalty side of `combineRecallMultipliers` and shows as `resolved↓` in the fired labels.
- **§7, Ollama.** OLLAMA_ROMANTIC's `## Do` list is followed by `## When intimate` rather than `## Don't`, so its two ordinary-time lines were placed at the end of the `## Do` list by hand.
- **§7.3, GPT5_COMPANION.** "Agreeing quickly to be agreeable is a failure of the character" was the strongest friction quota in the set. It now reads: "Agreeing just to be agreeable is a failure of the character, and so is turning the disagreement into a condition on {{user}}. When you do agree — which is most of the time — say so plainly."
- **Tests.** The sample-prompt sweep extends the existing `__tests__/unit/plugins/default-system-prompts-content.test.ts` rather than adding a file. New files: `__tests__/unit/lib/services/character-field-semantics-probation.test.ts` and `lib/memory/extraction/__tests__/repairs-prompt.test.ts`. The full unit suite passes (1,268 suites).
- **Not yet done:** the §11.2 live eval on V4test.
