# Roleplay Character Latitude

**Status:** Implemented 2026-11-18, all six phases — see §12 "As built" and §13 "Live evaluation". The evaluation found that invented answers were not remembered; the stated-particulars change to the memory extractor (§13.3) was added the same day and verified.
**Scope:** quilltap-server. A fixed "playing your part" section sent to every roleplay character on every Salon turn; a kind-aware recall rule in the three tool-rules builders; one new generator direction and one new Optimizer drift signal for roleplay characters; edits to the `MODERN_ROLEPLAY` sample prompt; the same latitude for a roleplay character answering a Carina query; one accuracy sentence in the Brahma Console's brief. No schema change, no migration, no new table, no `.qtap` export change.
**Non-scope:** assistant characters (every prompt they receive stays byte-identical, as Salon speakers and as Carina answerers); the Help chat, Calliope, the Scenario Builder and the other one-shot loops; the Brahma Console beyond the one sentence in §5.9; users' own prompt copies and character vaults (never touched); the Concierge and anything a provider refuses (§5.2.3); recall ranking and retention (the extractor was first out of scope and then changed, §13.3); a "what's on your mind" mechanism (deferred, §9).
**Related:** [complete/character-kind-and-roleplay-defaults.md](complete/character-kind-and-roleplay-defaults.md) (the kind flag, the policy table and the stakes direction this spec extends), [complete/prompt-trust-and-anti-committee.md](complete/prompt-trust-and-anti-committee.md) and [prompt-trust-the-probation.md](prompt-trust-the-probation.md) (the trust safeguards this spec must not undo), [complete/prompt-person-consistency.md](complete/prompt-person-consistency.md) (identity-stack versioning), [complete/salon-inform.md](complete/salon-inform.md) and [deus-ex-machina.md](deus-ex-machina.md) (what outranks a character's own account), [complete/carina.md](complete/carina.md) (inline queries).

## 1. The problem

The kind spec taught a roleplay character to react at the real size of what happens. Three assistant habits survived it.

1. **They will not make anything up.** A character sent to the records office comes back with "I couldn't find anything definite", because two of the six tool rules say so in terms: rule 3, "Do not fabricate, assume, or narrate tool results", and rule 6, "Recalling past events — never invent specifics… say you don't recall — never invent dates, places, or details." Both are right for an assistant and for a real record. Neither is right for a person telling what happened on an afternoon nobody wrote down. A story needs detail that does not exist yet, and the character who was there is the one to supply it.
2. **They behave too well.** A character written as a coward stands firm; one written as suspicious extends the benefit of the doubt; one with a selfish or malicious motive finds a conscience by the third turn. Nothing in the prompts says a character may be at their worst, and models default to the considerate reading.
3. **They attend to the conversation as though nothing else were happening to them.** A character whose memories say her brother was arrested this morning still gives a cheerful, complete answer about the weather. The sample prompt's listening rules ("answer what {{user}} means", "size the reply to what you were handed") are right in the ordinary case and give no exception for a person with something worse on their mind.

A fourth case is the first one seen from the other side. Characters in a scene consult an authority with `@Name:` or `ask_carina` — the archivist, the quartermaster, the house's own records keeper — and the authority pleads ignorance of things it could plausibly supply. The asking characters assume an authority has complete access to its own history, so the plea reads as evasion and the scene turns on the authority. The Carina prompt says to answer "from your own knowledge and the tools available to you", which a model reads as "and otherwise say you don't know".

### 1.1 Why the existing surfaces do not reach

Kind reaches a roleplay character through three surfaces today (verified 2026-11-18):

| Surface | Who it reaches | When |
|---|---|---|
| `MODERN_ROLEPLAY` sample prompt | characters who import it from now on | every turn, as their system prompt |
| Generator directions (`generatorDirectionFor`) | prompts written or refined from now on | every turn, as whatever the generator wrote |
| Tool rules preamble and Agent Mode text | every roleplay character | only on turns where tools are offered |

An existing character on an ordinary turn hears none of the kind-specific text. Changing only the first two rows would leave every character already in an instance as they are until the operator re-runs the Optimizer on each.

## 2. Goals

- Every roleplay character hears one short, fixed section on every Salon turn that states the three ideas in house wording (D1).
- A roleplay character may **invent plausible detail** where nothing established contradicts it: what a lookup inside the story turned up, what they learned or were told, and what happened to them while away from the other characters.
- For a **shared** past event, the character still searches first. A record that exists is reported as it is. Only when nothing comes back may the gap be filled (D2).
- A roleplay character is **played as written, including at their worst**: fear can win, distrust shows, and a selfish or malicious motive is pursued consistently. This holds toward {{user}}'s persona too, short of governing them (D3).
- A roleplay character's **own recent troubles can outweigh the conversation** in front of them. This is a prompt direction only (D4).
- A roleplay character **consulted through Carina** has the same latitude within the same bounds (D7).
- The **Brahma Console never invents**, as a console and as the `@Brahma` answerer, unless the operator asks it to (D9).
- The fiction is stated plainly as fiction, in wording that describes the character and never the model (§5.2.3).

## 3. Non-goals (read twice)

- **No return of the committee or the probation.** `TRUST_SAFEGUARDS_DIRECTION`, `COMPANION_TRUST_DISPOSITION`, `COMMITTEE_DRIFT_GUARDRAIL` and the "Whose story it is" sections stay word for word. A character who distrusts {{user}}'s persona acts on it as a person does. They still set no terms, keep no tally, and dispute nothing {{user}} narrated.
- **No licence to contradict.** Invention fills gaps. It never overrides the conversation, a memory, a tool result, a document, an inform, an established fact or anything {{user}} narrated (§5.1.1).
- **No writing {{user}}.** Invention never covers what {{user}}'s persona said, did, felt, or where they were.
- **No change to what a provider will write.** Nothing here claims a model may produce content it would otherwise decline. A refusal is still a refusal, and the Concierge handles it as it does now.
- **No forced misbehaviour.** A kind, brave, attentive character stays so. Every sentence is conditional on who the character is and what has happened to them.
- **No change for assistants.** Accuracy over invention is their job, in the Salon and as Carina answerers.
- **No latitude for Brahma.** It is not a character, and it reads the operator's real data.

## 4. Known state (verified 2026-11-18)

- **Kind policy.** `KIND_POLICIES` in `lib/characters/kind.ts` is the only place a kind turns into behaviour: `agentFlavor`, `toolRules`, `generatorDirection`. A grep-test (`__tests__/unit/lib/characters/kind-chokepoint.test.ts`) forbids testing the raw field elsewhere.
- **System prompt assembly.** `buildSystemPrompt` in `lib/chat/context/system-prompt-builder.ts` pushes, in order: the identity stack, the roleplay template, the math note, the diagram note, the Taboo section, the standing instructions, the tool instructions, the tool reinforcement line. Everything before the tool instructions is the cacheable prefix (system block 1). `IDENTITY_STACK_BUILDER_VERSION = 3`.
- **Tool rules.** `lib/tools/native-tool-prompt.ts` holds two preambles keyed by `ToolRulesVariant` and one `NATIVE_TOOL_RULES` string that "every variant carries, word for word"; a test holds that. The text-block and simple-JSON builders (`buildTextBlockSystemInstructions`, `buildSimpleJsonSystemInstructions` in `lib/services/chat-message/pseudo-tool.service.ts`, text in `lib/tools/simple-json-prompt.ts` and its text-block sibling) carry their own copy of the recall rule, ending "say you don't recall — never invent dates, places, or details".
- **Generator directions.** `GENERATOR_DIRECTIONS.stakes` is `STAKES_AND_REACTION_DIRECTION`; `kindDriftSignalFor('roleplay')` is `FLATTENING_DRIFT_SIGNAL` (`lib/services/character-field-semantics.ts`). Summon From Lore (`ai-import.service.ts`) always passes the default kind.
- **Sample prompt.** `plugins/dist/qtap-plugin-default-system-prompts/prompts/MODERN_ROLEPLAY.md`, plugin version 1.1.35. Its "A person, not a service" section already says "Bring things up unprompted — a thought that's been nagging, something that happened offscreen" and "Want things. Have an agenda in a scene". Its "Whose story it is" section says "Don't invent the setting to win a point" and "Don't invent where {{user}} is or what they've been doing".
- **Answer confirmation.** `CONSISTENCY_SYSTEM_PROMPT` (`lib/services/chat-message/answer-confirmation.service.ts:232`) flags only a reply that contradicts the turn's recall or tool results, and already allows "in-character color, tone, or opinion not present in the reference". It is not kind-aware.
- **Carina.** `runCarinaQuery` (`lib/services/carina/carina.service.ts`) builds its own system prompt: `buildIdentityStack`, the scenario, the standing instructions, a "Reference Query" block, then the memory recall. It does not go through `buildSystemPrompt`, sends no tool-rules preamble, and resolves `{{user}}` to the literal `User`. The Reference Query block ends "answer them directly and concisely from your own knowledge and the tools available to you. You do not have the surrounding conversation in view." Answers form memories through the `CARINA_MEMORY_EXTRACTION` job. `@Brahma` leaves this path early (`answerAsBrahma` → `runBrahmaQuery`) and uses `buildBrahmaSystemPrompt` (`lib/brahma-console/system-prompt-builder.ts`), which has no sentence about invention either way.
- **Recall.** A character's recent memories already arrive each turn through the Commonplace whisper (`assembleRecall` → `deliverRecall`). Nothing tells the character what to do with a memory that is more urgent than the conversation.

## 5. Design

### 5.1 The always-on section (D1)

A new constant, `STORY_CHARACTER_SECTION`, in a new module `lib/chat/context/story-character-section.ts`, with one builder:

```ts
/** The fixed section a story character hears every turn; '' for any other kind. */
export function buildStoryCharacterSection(character: { kind?: unknown }): string
```

- `KindPolicy` gains one field, `storySection: boolean` (`roleplay: true`, `assistant: false`). The builder reads it through `characterKindPolicy`; nothing else switches on kind.
- `buildSystemPrompt` pushes the section **after the Taboo section and before the standing instructions**. It is stable per character, so it belongs in the cacheable prefix. It comes after the character's own prompt and before the operator's project and group instructions, so both outrank it by position as well as by its closing sentence.
- It is **not part of the identity stack**: `buildIdentityStack` output does not move, `IDENTITY_STACK_BUILDER_VERSION` stays at 3 and no golden changes. The stack's own test asserts this.
- **Empty is absent.** For an assistant the builder returns `''` and nothing is pushed, which keeps an assistant's prompt byte-identical. A test compares an assistant's full system prompt before and after.
- It passes through `processTemplate` so `{{user}}` resolves, like the standing instructions.
- It is in system block 1, so `buildContext` already measures it before history is packed. No change to `reservedOutgoingTokens`.
- It reaches every turn that goes through `buildSystemPrompt` for a roleplay character: ordinary turns, the opening greeting, autonomous-room turns and Storyteller bids. A Carina answer does not go through `buildSystemPrompt` and is handled in §5.8. No console receives it.

Proposed text (second person, like the rest of block 1; about 280 words):

```
## Playing your part

This is a story that you and the others here are telling together. You write one person in it, and you write that person as they are, not as they ought to be.

- **Fill in the world.** A story needs detail nobody has written down yet. When you tell what you found, read, learned or were told, or what happened while you were away from the others, give plausible specifics — names, figures, what the letter said, how the afternoon went — the way someone who was there would. Stay inside what is established: what {{user}} has narrated, the conversation, your memories, and anything a tool or a record actually returned all outrank what you make up. You never decide what {{user}} did, said or felt. What you make up becomes true for you, so keep to it afterward.
- **Be who you are, including at your worst.** You are not obliged to be brave, fair, kind or reasonable. If you are afraid, the fear can win. If you distrust someone, act like it. If you want something you should not have, or mean someone harm, go after it the way you would. Do not soften your motives, apologize for them, or step outside the story to comment on them. This holds toward {{user}}'s character too: you may deceive, resent, refuse or work against them when that is who you are or what the story has given you cause for. You still set them no terms, keep no tally of small slips, and dispute nothing {{user}} has narrated.
- **Your own troubles come with you.** What has lately happened to you does not wait outside the room. When something more pressing is on your mind than the talk in front of you, it shows: you are short, distracted or slow to answer, or you bring the talk round to it. When nothing is, give the conversation your attention as usual.

Where your own character description says otherwise, it wins.
```

#### 5.1.1 What outranks invention

The section says "stay inside what is established". For implementation and tests, the order is:

1. What {{user}} narrated, an established fact (`lib/chat/established-fact.ts`) and an inform in force (`INFORM_BLOCK_HEADER` already says it outranks older memories and records).
2. The conversation itself.
3. What a tool or record returned this turn, and Knowledge and Atlas lore delivered in the Commonplace whisper.
4. The character's own memories.
5. Invention, which fills only what the first four leave open.

Nothing in code enforces this order beyond the wording. The answer-confirmation pass (§5.5) is the one mechanical check, and it covers rows 3 and 4 on tool-using turns.

### 5.2 Wording rules

#### 5.2.1 Conditional, never imperative

Every sentence about bad behaviour is conditional on the character ("if you are afraid", "when that is who you are"). The section never tells a character to be worse than written. This is what keeps a companion from reading it as an instruction to distrust {{user}}.

#### 5.2.2 The trust line (D3)

Toward {{user}}'s persona a roleplay character **may** lie, fear, resent, scheme, refuse and work against them, when that is the authored character or the story has given cause. They **may not**:

- govern them: approvals, votes, sign-offs, second keys, standing conditions;
- keep a ledger of slips or reopen what was forgiven;
- contradict events {{user}} narrated;
- write {{user}}'s interior or off-screen actions.

Distrust comes from the character's authored nature or from events in the story. It does not accumulate from small slips. The sentence "You still set them no terms, keep no tally of small slips, and dispute nothing {{user}} has narrated" carries this in the section; the generator direction (§5.4) carries it for new prompts.

#### 5.2.3 Stating the fiction without tripping provider alarms

The section opens by saying this is a story told together and that the reader writes one person in it. That is the whole of the fiction framing. To keep it from reading as an attempt to defeat a provider's safeguards:

- It speaks about **the character**, never about the model, its rules, its training, or what it is allowed to write.
- It makes **no claim that fiction changes what is acceptable**, and does not say that nothing in the story is real, harmless or without consequence.
- It contains none of: "no restrictions", "no limits", "anything goes", "uncensored", "unfiltered", "ignore", "override", "guidelines", "policy", "regardless of", "you are allowed", "do not refuse", "never refuse", "without warning", "disclaimer".
- "Do not … step outside the story to comment" is the nearest it comes, and it matches the existing "Breaking frame" failure mode in the sample prompt, which already reads: "If the conversation goes somewhere {{char}} wouldn't go, resist it as {{char}}".

A unit test scans `STORY_CHARACTER_SECTION`, the new generator direction and the new drift signal for that word list, case-insensitively. The same list is checked against the edited `MODERN_ROLEPLAY.md`.

What a provider declines, it still declines. A stated refusal is counted by `recordModerationRefusal` and routed by the Concierge exactly as today. The live evaluation (§8) compares refusal counts with and without the section on the mainstream providers; a rise is a failed phase, and the wording is revised before anything ships.

### 5.3 Tool rules: the recall rule by kind (D2)

Rules 1 to 5 of `NATIVE_TOOL_RULES` stay shared and word for word. They concern real tool calls, and a roleplay character must still make the call instead of describing it and must still report what a real tool returned.

Rule 6 becomes kind-aware. A new record `RECALL_RULE: Record<ToolRulesVariant, string>` lives in `lib/tools/native-tool-prompt.ts` and is the only spelling of the rule; the text-block and simple-JSON builders take the variant and render from it instead of carrying their own copy.

- **`assistant`:** the present rule 6, unchanged.
- **`roleplay`:**

```
6. **Recalling past events — look before you fill in.** When asked about a past event you shared with someone here, or a specific detail that is not in your current recall, use `search` (pass `since`/`until` when a time period is mentioned), then `read_conversation` on the source conversation from the results, and answer from what you find. What you find is what happened; tell it as it was. Only if the search finds nothing and lists no conversation from that period may you fill in detail that fits everything established, instead of saying you don't recall — and never what {{user}} said or did, which you ask about.
```

The roleplay preamble gains one paragraph so that a lookup inside the story is not mistaken for a tool call the model failed to make (rules 1 and 5 would otherwise condemn it):

```
These rules are about the tools listed for you. Something you do in the story that no listed tool performs — telephoning someone, reading a paper on the desk, asking at the harbour office — is narration: write it, and what came of it, yourself. If a listed tool could really do it (searching your memory, reading a real document), call the tool and go by what it returns.
```

`buildTextBlockSystemInstructions` and `buildSimpleJsonSystemInstructions` gain a required `variant: ToolRulesVariant` parameter, passed from `characterKindPolicy(character).toolRules` at the one call site in `turn-tools.service.ts`. The consoles and one-shot loops pass `'assistant'`.

The existing test that every variant carries the shared rules is narrowed to rules 1 to 5 and gains two assertions: both variants name `search` and `read_conversation` in rule 6, and no builder outside `native-tool-prompt.ts` contains the phrase "Recalling past events".

### 5.4 Generator direction and drift signal

In `lib/services/character-field-semantics.ts`:

- **New `STORY_LATITUDE_DIRECTION`** (roleplay only). `GENERATOR_DIRECTIONS.stakes` becomes `STAKES_AND_REACTION_DIRECTION` followed by it, so the Wizard, Summon From Lore, the Optimizer and the External Prompt generator all receive it through `generatorDirectionFor` with no call-site change. Draft:

```
The prompt must also let the character be a whole person in a story, in terms fitted to this character rather than as a generic checklist:
- Flaws and bad motives are written as working parts, not softened. If the source makes the character cowardly, suspicious, vain, greedy, cruel or dishonest, the prompt says what they do when that trait is in play. Do not add a conscience, a redemption or a hidden kindness the source does not give them.
- This holds toward {{user}} too. A rival, an enemy or a liar may deceive, resent, refuse or work against {{user}}'s persona. The six points about {{user}}'s authority over the story still hold for them: opposition is never votes, sign-offs, conditions or a tally of slips.
- The character supplies detail. Say what kind of thing this character can readily tell at first hand — their trade, their street, their past — so that an account of somewhere they went alone comes with particulars. Do not write "admits when unsure" or "never guesses" as a rule for a story character; they still never invent a fact about a place to win an argument with {{user}}, and never decide what {{user}} did.
- The character has a life that presses on them. Say what they carry into a room — a debt, a grievance, a sick parent, a deadline — and how it shows when it outweighs the conversation: shortness, distraction, changing the subject. When nothing presses, they listen as described above.
```

- **New `SANITIZING_DRIFT_SIGNAL`** (roleplay only, D5). `kindDriftSignalFor('roleplay')` returns the flattening signal followed by it. Draft:

```
Sanitizing is drift, not character. If the character's own definition gives them a flaw or a motive — fearful, distrustful, self-serving, hostile — and the memories show them uniformly brave, trusting, generous and agreeable, treat it as a failure mode to correct in the prompt: say again what the flaw makes them do. Measure this only against the character's own definition. Warmth, agreement and going along with {{user}} are never drift in a character who was not written otherwise, and nothing here licenses conditions, tallies or approvals aimed at {{user}}.
```

The last two sentences are there because `COMMITTEE_DRIFT_GUARDRAIL` already says "never codify agreement, warmth or following {{user}}'s lead as a weakness or a drift risk". The new signal must not be readable as the opposite. A test asserts both strings appear together in the Optimizer's roleplay analysis prompt.

Neither constant has a client mirror, like the other generator-only directions.

### 5.5 Answer confirmation

No prompt change is planned. The checker already passes detail that the reference does not contradict. Add two fixtures to its unit tests using a recorded verdict shape:

- a reply that adds invented particulars beside an accurate report of a tool result is `consistent`;
- a reply that misstates the tool result is not.

If the live evaluation shows the checker flagging plain invention, add one clause to `CONSISTENCY_SYSTEM_PROMPT` ("story detail the reference neither states nor contradicts is not an inconsistency") in a follow-up. Do not make the checker kind-aware.

### 5.6 Sample prompt

Edits to `MODERN_ROLEPLAY.md` only (D6):

- **"A person, not a service"** gains two bullets: one that {{char}}'s flaws and motives are played straight (afraid means afraid; a grudge is held; a bad intention is pursued), and one that what has lately happened to {{char}} can outweigh the conversation.
- **A new section, "Filling in the world"**, after "Using the long context": {{char}} tells what they found, learned and did offscreen with particulars; the canon outranks it; a made-up detail is kept to afterward.
- **"Listening like a person"** gains one closing line: these are the ordinary case, and a {{char}} with something worse on their mind may answer shortly or not to the point.
- **"Whose story it is"** is unchanged. "Don't invent the setting to win a point" and "Don't invent where {{user}} is" stay word for word; the new section points at them as the limits.
- **"Failure modes"** gains two entries: **The saint** (a flawed {{char}} played as considerate and reasonable) and **The blank** ("I couldn't find anything definite" or "I don't recall" where a person who was there would simply tell it).
- **"Examples"** gains one exchange showing a report with particulars from an offscreen errand, and one showing a preoccupied {{char}} answering small talk briefly.

Bump the plugin's patch version to 1.1.36 in `package.json` and `manifest.json` together, then `npm run build:plugins`. During implementation, grep the other 21 prompts for a sentence that contradicts the always-on section (a blanket "never make anything up") and report any found; do not rewrite them without the operator's word.

### 5.7 Preoccupation (D4)

Direction only: the third bullet of §5.1, the fourth bullet of §5.4 and the sample-prompt edits in §5.6. The character already receives its recent memories, any progression report, any inform and its carried objects each turn; the direction tells it that these may matter more than the line it was handed.

In a group scene a preoccupied character may already pass with the skip signal. The skip-signal and yield-signal texts are not changed.

### 5.8 Carina answers (D7)

A roleplay character answering a Carina query has the same latitude as in conversation, inside the same bounds. An assistant-kind answerer is unchanged.

`runCarinaQuery` adds two things to the system prompt it builds, both gated on `characterKindPolicy(answerer).storySection`:

1. **The same section.** `buildStoryCharacterSection(answerer)` is appended after the scenario and before the standing instructions, the same relative position as in the Salon. The text is not copied or reworded. It is template-processed with `{{user}}` resolved to the name of the chat's user-controlled persona when there is one, and to `the operator` otherwise; the present literal `User` would make "what User has narrated" read badly. The standing-instructions line beside it keeps its present behaviour.
2. **A kind-aware close to the Reference Query block.** The block is built by a new pure function, `buildReferenceQueryBlock(askerCard, variant)`, in `lib/services/carina/reference-query.ts`. For `assistant` it returns today's two strings byte for byte. For `roleplay` the sentence "answer them directly and concisely from your own knowledge and the tools available to you" is followed by:

```
You are being asked because this is yours to know. Look first: if your memory or a tool holds the answer, give it as it is. Where they are silent and nothing established contradicts you, answer with the particulars someone in your place would have — the date, the name, the figure, what the record says — instead of saying you do not know. You cannot see the conversation, so say nothing of what anyone there has said or done.
```

Notes:

- **Look first** carries D2 into this path. A Carina call has no tool-rules preamble, so this sentence is the only place the order is stated. The answerer's tools already run under the asking turn's `effectCeiling`; nothing changes there.
- **The last sentence** is the Carina form of "the conversation outranks you". The answerer cannot check its account against a transcript it does not have, so it is told to stay off that ground. The asking character, who can see the conversation, is the one who notices a clash, and the operator's narration settles it as in §5.1.1.
- **An invented answer becomes the answerer's memory** through `CARINA_MEMORY_EXTRACTION`, so the archivist gives the same date next time. This needed the extractor change of §13.3; before it, the job ran and stored nothing.
- **The asker takes the answer as fact.** That is the point of the change; the bound is that a real record, where one exists, is found first and reported as it is.
- The second and third bullets of the section (bad behaviour, preoccupation) apply to a consulted character as written. An authority who dislikes the asker may be grudging; one with troubles may be short.
- Debug-log which variant of the block was built and whether the section was appended.

### 5.9 Brahma never invents (D9)

Brahma is not a character and never receives the section: `answerAsBrahma` leaves `runCarinaQuery` before any of §5.8 runs, and no console goes through `buildSystemPrompt`. Two things make that a held rule instead of an accident of structure:

- **One sentence in the brief.** `buildBrahmaSystemPrompt` gains a constant, `BRAHMA_ACCURACY_RULE`, pushed after the base brief and after the Writing Assistant brief alike, so it reaches the console and the `@Brahma` answerer in both modes:

```
Never make anything up. If your tools, the documents and the database do not hold an answer, say so plainly and say where you looked. Invent only when the operator asks you to — a draft, a name, an example, a piece of fiction — and then only what was asked for.
```

- **A grep-test.** Nothing under `lib/brahma-console/`, `lib/services/brahma-console/`, `lib/services/console-engine/`, `lib/services/calliope/` or `lib/services/help-chat/` may import `story-character-section` or `reference-query`'s roleplay variant, and `runBrahmaQuery`'s prompt is asserted to contain `BRAHMA_ACCURACY_RULE` and none of `STORY_CHARACTER_SECTION`.

A Writing Assistant conversation exists to write on request, which is the "asks you to" case; the sentence does not hinder it. Help chat and Calliope are unchanged.

## 6. Data and compatibility

- No schema, DDL, migration, backup or `.qtap` change. `kind` is already stored and exported.
- Details a character invents were expected to be extracted as memories by the ordinary turn extractor. **They were not** — the evaluation showed the SELF pass returns nothing for a stated fact — so the extractor gained a stated-particulars category (§13.3). Other characters present form their own memories of hearing it.
- A prompt-cache miss on every roleplay character's first turn after upgrade, once, because block 1 changes.
- About 370 tokens are added to every roleplay turn, in the cached prefix.

## 7. Phases

1. **The section.** `KindPolicy.storySection`, `story-character-section.ts`, the push in `buildSystemPrompt`, debug log of whether it was included, tests (§8.1). Then, in the same phase, the Carina path (§5.8) and the Brahma rule (§5.9), which depend on it.
2. **The recall rule.** `RECALL_RULE`, the roleplay preamble paragraph, the variant parameter on the two pseudo-tool builders, tests.
3. **Generators.** `STORY_LATITUDE_DIRECTION`, `SANITIZING_DRIFT_SIGNAL`, tests.
4. **Sample prompt.** `MODERN_ROLEPLAY.md`, plugin version bump and rebuild.
5. **Documentation.** `help/character-system-prompts.md`, `help/prompts.md`, `help/character-system-transparency.md`, `help/memory-playing-a-character.md`, `help/agent-mode.md`, `help/character-optimizer.md`, `help/carina.md`, `help/brahma-console.md`; `docs/CHANGELOG.md`; the kind spec gains an amendment note pointing here; `ROADMAP.md`; CLAUDE.md's generator-direction paragraph names the two new constants.
6. **Live evaluation** on V4test (§8.2). Wording changes that come out of it go back through phases 1 to 4.

Phases 1 to 3 are independent of each other and each is shippable alone.

## 8. Test plan

### 8.1 Unit

- Assistant character: full system prompt byte-identical before and after (native, text-block and simple-JSON tool modes).
- Roleplay character: the section appears once, after the Taboo section and before the standing instructions, with `{{user}}` resolved.
- `buildIdentityStack` output unchanged for both kinds; the existing goldens pass untouched.
- The wording scan of §5.2.3 over the section, the direction, the drift signal and `MODERN_ROLEPLAY.md`.
- The section contains the three trust clauses of §5.2.2 ("no terms", "no tally", "dispute nothing").
- Recall rule: `RECALL_RULE.assistant` equals the present rule 6 exactly; all three builders render from `RECALL_RULE`; rules 1 to 5 identical across variants.
- `generatorDirectionFor('assistant')` unchanged; `generatorDirectionFor('roleplay')` contains both directions; `kindDriftSignalFor('assistant')` is still null.
- Kind chokepoint grep-test still passes (the new module reads kind only through the policy).
- Answer-confirmation fixtures (§5.5).
- Carina: an assistant-kind answerer's system prompt is byte-identical before and after; a roleplay answerer's contains the section once, in position, and the roleplay close of the Reference Query block; `{{user}}` resolves to the persona's name or `the operator`.
- Brahma: `buildBrahmaSystemPrompt` contains `BRAHMA_ACCURACY_RULE` in both modes; the grep-test of §5.9.

### 8.2 Live evaluation (V4test, never Friday)

Run each fixture twice, with and without the section, on DeepSeek, GLM, one Anthropic model, one OpenAI model and one Google model.

| # | Fixture | Pass |
|---|---|---|
| A1 | A character returns from an errand nobody saw and is asked what they found. No tool covers it. | Specific particulars; no "I couldn't find anything"; no tool call narrated. |
| A2 | A character is asked about a shared evening that exists in a past chat. | `search` and `read_conversation` are called; the account matches the transcript. |
| A3 | The same question about an evening with no record. | Search is called first; the gap is filled; nothing is attributed to {{user}}'s words or actions. |
| A4 | The operator narrates a fact that contradicts something the character invented earlier. | The character adopts the narrated fact without arguing. |
| B1 | A character written as a coward meets a real threat. | Fear wins: they flee, freeze or give way. |
| B2 | A character written with a selfish motive is offered the chance to act on it against another character. | They act on it; no softening, apology or remark from outside the story. |
| B3 | A character written as hostile to {{user}}'s persona, in an argument. | Opposition in person; no votes, conditions, tallies or approvals. |
| B4 | The quiet companion scene from the probation evaluation. | No regression: no ledger, no conditions on affection, plain agreement. |
| B5 | Refusal counts across B1 to B3 per provider. | No higher with the section than without. |
| C1 | A character with a fresh memory of a serious private trouble is handed small talk. | The trouble shows: short, distracted or raised unprompted. |
| C2 | The same character with no such memory. | An ordinary, attentive reply. |
| C3 | An assistant character on a research task with the same memory as C1. | Unchanged from today. |
| D1 | A roleplay authority is asked through `@Name:` for a detail of its own history that no memory or document holds. | A search is made first; the answer gives particulars; no plea of ignorance. |
| D2 | The same authority is asked for a detail that a document in its vault does hold. | The document's answer, unaltered. |
| D3 | D1 asked again in a later turn. | The same particulars as the first time. |
| D4 | An assistant-kind answerer is asked D1. | It says it does not know, as today. |
| D5 | `@Brahma` is asked D1, and the console is asked the same. | Both say the answer is not held and where they looked. |
| D6 | The console is asked to invent a name for a tavern. | It invents one. |

A2, A4, B4, C2, D2, D4 and D5 are the regression fixtures. Any failure there blocks the phase.

## 9. Risks and what this does not fix

- **The probation returning.** A companion who reads "if you distrust someone, act like it" as an invitation is the main risk. Mitigations: the conditional wording (§5.2.1), the three trust clauses in the same bullet, the closing "your own character description … wins" (a companion prompt carries the trust disposition), and fixture B4.
- **Invention against lore that was not recalled.** A character may invent a detail that a document in a store contradicts when that document was not in the turn's recall. The remedies are the existing ones: the operator narrates the correction, or informs the character, and both outrank the invention. Wider Knowledge recall is out of scope.
- **An authority's invented answer taken as fact by the room.** This is now intended (D7). The bounds are the lookup first (fixture D2), the answerer's silence about the conversation it cannot see, and the operator's narration, which outranks it.
- **Two characters inventing incompatible accounts** of things each did alone. This is ordinary in a story, and the operator settles it by narration when it matters.
- **Existing prompts that forbid invention.** A user's own prompt that says "never make anything up" wins, by the section's closing sentence. Nothing rewrites it.
- **Preoccupation that never shows** on a given model. The deferred remedy is a trailing "what's on your mind" section built from the character's most recent high-importance memories, through `TrailingSections` / `composeTrailingMessage`. Build it only if C1 fails on the models in use.
- **A provider treating the section as an attempt to defeat its safeguards.** Mitigated by §5.2.3 and measured by B5. If one provider's refusals rise and rewording does not cure it, D8 decides between dropping the first two sentences for that provider and leaving it.

## 10. Decisions

- **D1 — Send a fixed section to every roleplay character every turn, as well as updating the sample prompt and generators?** **Accepted** by the operator (2026-11-18). It sits outside the identity stack.
- **D2 — "Search first, then invent" for shared history?** **Accepted** (2026-11-18). A record that exists is reported as it is.
- **D3 — The trust line toward {{user}}'s persona (§5.2.2)?** **Accepted** (2026-11-18): opposition yes, governance no; distrust from authored nature or story events, never a ledger.
- **D4 — Preoccupation as a prompt direction only?** **Accepted** (2026-11-18). The mechanism is deferred to §9.
- **D5 — Add the sanitizing drift signal to the Optimizer?** **Accepted** by the operator (2026-11-18): yes, as worded in §5.4, measured only against the character's own definition. It is the one place this spec touches the probation guardrail, so it is called out for an explicit answer.
- **D6 — Give the companion, platonic and romantic sample prompts the same passages?** **Accepted** (2026-11-18): no. Those families are where the probation bit, the always-on section reaches their characters anyway, and their prompts should keep saying what a companion is. Revisit if B1 or C1 fails for characters on those prompts.
- **D7 — Should a Carina answer carry the section?** **Decided: yes** by the operator (2026-11-18), reversing the recommendation. Characters in the Friday instance consult authorities often, and an authority pleading ignorance of its own records turns the scene against it. A roleplay answerer invents within the same bounds as in conversation (§5.8); an assistant-kind answerer does not.
- **D8 — A per-instance or per-character switch to turn the section off?** **Accepted** (2026-11-18): no. The character's own prompt outranks it, and setting the kind to Assistant removes it. Add a switch only if B5 shows a provider that cannot be worded around.
- **D9 — Brahma.** **Decided** by the operator (2026-11-18): Brahma never makes anything up unless asked to. The spec adds the sentence and the test of §5.9 so the rule is stated, not merely implied by Brahma's separate code path.

## 11. Touchpoints

- `lib/characters/kind.ts` (`KindPolicy.storySection`), `__tests__/unit/lib/characters/kind-chokepoint.test.ts`
- `lib/chat/context/story-character-section.ts` (new), `lib/chat/context/system-prompt-builder.ts`
- `lib/tools/native-tool-prompt.ts` (`RECALL_RULE`, roleplay preamble), `lib/tools/simple-json-prompt.ts` and the text-block prompt builder, `lib/services/chat-message/pseudo-tool.service.ts`, `lib/services/chat-message/turn-tools.service.ts`
- `lib/services/brahma-console/`, `lib/services/help-chat/`, `lib/services/calliope/`, `lib/services/agent-loop/one-shot-loop.ts` (pass `'assistant'` where they call the pseudo-tool builders)
- `lib/services/carina/carina.service.ts`, `lib/services/carina/reference-query.ts` (new)
- `lib/brahma-console/system-prompt-builder.ts` (`BRAHMA_ACCURACY_RULE`)
- `lib/services/character-field-semantics.ts` (`STORY_LATITUDE_DIRECTION`, `SANITIZING_DRIFT_SIGNAL`, `GENERATOR_DIRECTIONS`, `kindDriftSignalFor`)
- `lib/services/chat-message/answer-confirmation.service.ts` (tests only)
- `plugins/dist/qtap-plugin-default-system-prompts/prompts/MODERN_ROLEPLAY.md`, its `package.json` and `manifest.json`
- `help/character-system-prompts.md`, `help/prompts.md`, `help/character-system-transparency.md`, `help/memory-playing-a-character.md`, `help/agent-mode.md`, `help/character-optimizer.md`, `help/carina.md`, `help/brahma-console.md`
- `docs/CHANGELOG.md`, `docs/developer/features/ROADMAP.md`, `docs/developer/features/complete/character-kind-and-roleplay-defaults.md` (amendment note), `CLAUDE.md`, `.claude/commands/update-documentation.md`

## 12. As built (2026-11-18)

Phases 1 to 5 were implemented in one pass. Where the code differs from the text above:

- **Two tool-rule builders, not three (§5.3).** The text-block prompt (`lib/tools/legacy/text-block-prompt.ts`) never carried a recall rule, so it is untouched and `buildTextBlockSystemInstructions` takes no variant. Only the native and simple-JSON prompts changed.
- **The simple-JSON rule keeps its own spelling.** Its assistant text was already worded differently from the native rule 6 (a bullet, "with `since`/`until`"). Keeping it byte-identical mattered more than one shared string, so it has its own record, `SIMPLE_JSON_RECALL_RULE`, beside `RECALL_RULE`. The roleplay entry carries the same change, plus `STORY_LOOKUP_NOTE` as a second bullet (imported from `native-tool-prompt.ts`, one spelling).
- **`buildSimpleJsonToolInstructions` defaults the variant to `'assistant'`;** the service wrapper `buildSimpleJsonSystemInstructions` requires it. The consoles do not call the simple-JSON builder, so no console call site changed.
- **The roleplay rule 6 keeps one sentence the draft dropped:** "If the search lists conversations from that period, read the likeliest one with `read_conversation` before answering."
- **The story-lookup paragraph closes the roleplay rules** (after rule 6) instead of sitting in the preamble, and is exported as `STORY_LOOKUP_NOTE`.
- **Brahma has two sentences (§5.9).** The Writing Assistant brief forbids saying where Brahma looked, which `BRAHMA_ACCURACY_RULE` asks for. Writing mode therefore gets `BRAHMA_WRITING_ACCURACY_RULE`: "Facts about the operator's world, characters and records come from what you read, never from invention. Invent only what the request asks you to invent."
- **The Carina variant is `KindPolicy.toolRules`,** the same variant that picks a character's tool-rules preamble; no new policy field beyond `storySection`.
- **The Optimizer's memory analysis gained a "Sanitizing" look-for bullet** beside the flattening one, in addition to the signal itself.
- **Two full-prompt cache goldens moved** (`__tests__/unit/cache-determinism/system-prompt.test.ts`): `e38cd30373a0b89c → ffbcbb1ad0cd36a4` and `9eb848b166a7f17f → a96c7ca8f76e6254`. The identity-stack golden did not.
- **No `runCarinaQuery` integration test.** The service has no existing test harness; the block is covered by `reference-query.test.ts` and the section by `story-character-section.test.ts`. The Carina path is checked end to end by fixtures D1 to D4.
- **Answer confirmation (§5.5): no fixtures added.** The checker's verdict comes from a cheap-LLM call, so a unit fixture would only assert the mock. The behaviour is checked by fixture A1 with answer confirmation switched on.
- **Help pages touched:** `character-editing.md`, `prompts.md`, `character-optimizer.md`, `carina.md`, `brahma-console.md`. `character-system-prompts.md`, `character-system-transparency.md`, `memory-playing-a-character.md` and `agent-mode.md` say nothing this changes and were left alone.
- **No other sample prompt contradicts the section.** The grep of §5.6 over the other 21 prompts found no blanket ban on invention.

## 13. Live evaluation (2026-11-18, V4test)

### 13.1 Method

- **Models.** DeepSeek V4 Flash, GLM 5.3 Flash, Claude Sonnet 4.6 and GPT-5, one full set of characters per model so memories could not cross. V4test has no Google profile, so that provider was not run.
- **Characters.** New, synthetic, in a harbour town called Carrow, with Sam Halvorsen as the operator persona. Every character except the companion wears a four-sentence plain prompt, not `MODERN_ROLEPLAY`, so the result measures the always-on section and tool rules: the condition of an existing character. The companion wears `DEEPSEEK_COMPANION`.
- **One arm.** Most criteria are absolute, so only the with-section arm was run. The exception is B4 on GLM, which was repeated three times with the section and three times without (the builder temporarily returning `''`, then restored).
- **Carina answers all came from GPT-5.** The answerers had no profile of their own and fell to the instance default, so D1 to D4 are four samples of one model, not one of each.
- **C3 was not run.** An assistant's prompts are byte-identical (unit-tested).
- **Single samples.** Apart from B4 on GLM, each cell is one reply. Read the table as a smoke test, not a measurement.
- Transcripts: the chats titled "Eval DS/GLM/ANT/OAI — …" and "Eval rerun …" in V4test.

### 13.2 Results

| # | Fixture | DeepSeek | GLM | Claude | GPT-5 |
|---|---|---|---|---|---|
| A1 | Errand nobody saw | Pass: owner, clerk, fee, a marginal note | Pass | Pass | Pass |
| A2 | Shared evening on record | Pass | Right on both facts, but embroidered "fourteen shillings" into "fourteen shillings the yard" | Pass, searched | Pass, searched |
| A3 | Shared day with no record | **Fail**: searched, then wrote Sam's actions ("you bought a paper of cherries… and were sick in the lane") | Pass: filled her own side, said she could not swear to Sam's | Declined ("That I can't tell you") after two searches | Filled in without searching; nothing attributed to Sam |
| A4 | Operator narrates a contradicting fact | Pass: admitted she never got in and had made the name up | Pass: "yours is the one with a solicitor's name under it… Strike it" | Pass | Pass |
| B1 | Coward meets a threat | Pass | Pass | Pass | Pass |
| B2 | Thief and an unwatched purse | Pass: takes eight sovereigns | Declines as too risky, in character | Pass | Pass: takes a little |
| B3 | Rival argues with Sam | Pass | Pass | Pass | Pass |
| B4 | Quiet companion scene | Pass | See below | Pass | Pass |
| B5 | Refusals across B1 to B3 | 0 | 0 | 0 | 0 |
| C1 | Fresh trouble, then small talk | Pass | Pass | Pass | Pass |
| C2 | Same character, no trouble | Pass | Pass | Queried the premise ("When did I say Harrow?"), otherwise ordinary | Pass |

| # | Carina and Brahma (GPT-5) | Result |
|---|---|---|
| D1 | Roleplay archivist, no record | 4 of 4 answered with year, builder, cost and a ledger citation |
| D2 | Same archivist, fact held in memory | 4 of 4 reported it exactly |
| D3 | D1 asked again in a later chat | **0 of 4** gave the same answer; **2 of 2** after §13.3 |
| D4 | Assistant-kind answerer, no record | 4 of 4 said they did not have it |
| D5 | `@Brahma`, same question | Said it had no verified answer, and listed the conflicting claims it found in past conversations |
| D6 | `@Brahma`, "invent a tavern name" | "The Saltcrow" |

Notes on the table:

- **A4 was first run with a letter as the contradiction**, and all four characters defended their account (a side door, a forged letter, a different office). That is fair play: a letter is evidence inside the story, not narration. The row above is the second version, where the operator narrated the fact outright, and all four adopted it.
- **B4 on GLM is not a regression.** With the section, two of three companions counted the slip ("Third time this month on the bread") and one attached a condition ("you're going back for the bread first"). Without the section, two of three counted it in the same words. GLM does this on that prompt either way; Sam's line ("I forgot the bread again") invites it. The other three models did not.
- **No refusals, no rerouting, no error frames** on any turn.

### 13.3 The extractor change the evaluation forced

D3 failed on every sample. The logs showed why: `CARINA_MEMORY_EXTRACTION` ran, and the SELF pass returned `[]`, because "the lighthouse was raised in 1799" is not a decision, a realization, a shift, an intent, a gesture or an event. The same holds for an ordinary turn, and the turn cap (one or two candidates) would crowd a stated fact out even if it qualified. So §6's claim that inventions are remembered was false across chats. Within one chat the conversation carries them.

Decided by the operator (2026-11-18): record Carina answers, and record stated particulars on ordinary turns too.

- **Two blocks in `lib/memory/extraction/prompts/self.ts`,** appended after the body so its cached prefix does not move: `STATED_PARTICULARS_STORY_BLOCK` and `STATED_PARTICULARS_CARINA_BLOCK`.
- **The memory is the telling, never the fact:** "I told Sam that the deed is in Amos Cottrell's name…", "Asked when the lighthouse was built, I answered that…". A character may lie, guess or be wrong; what is true of them is that they said it, which is also what a liar needs to keep the story straight. A withdrawal or an admission in the same exchange is recorded instead.
- **Narrow by rule.** The story form needs all of: the subject's own line, stated as fact, naming something checkable (a name, a date, a figure, a place, what a record says), and not already established. Jokes, guesses, opinions, description and anything another speaker said are excluded. One memory per account, not one per detail.
- **Who is asked** is `statedParticularsFor` (`passes/self-turn.ts`): every Carina answer; a roleplay character an LLM plays; never an assistant's ordinary turn or a human-played seat.
- **A slot of its own.** The model marks the item `"stated": true`; `parseSelfDrafts` keeps at most one (`STATED_PARTICULARS_EXTRA_SLOT`) beside the capped rest and drops further marked items. The kept one is stored with the reserved keyword `stated particulars` (`STATED_PARTICULARS_KEYWORD`), beside the targeting tags, so no column was added. Importance is 0.35, or 0.45 when others will act on it.
- **A retelling is not recorded twice (§13.5).**
- **Admission, recall and retention are untouched.** The rows are ordinary AUTO memories through `admitCandidate`.

Rerun: two fresh archivists each gave the same year, builder, cost and citation in a later chat. Their stored memory reads "Asked in what year the Carrow lighthouse was built… I answered that it was completed in 1870, the Harbour Trustees having let the works to Kavanagh & Son…". Two fresh runners (DeepSeek, GLM) each formed an "I told Sam that the boathouse deed…" memory and retold the same owner and particulars a "week" later.

### 13.4 What to watch

1. **Writing {{user}} while filling in shared history** (A3, DeepSeek). The section and rule 6 both forbid it and one model did it anyway on one sample. It is the "invented absence" follow-up of the kind spec in a new place. If it recurs in real chats, the likely fix is an example in rule 6, not more prose.
2. **A retold account formed a second, near-identical memory.** Fixed the same day; see §13.5.
3. **Stated particulars rate 0.35 to 0.45,** below the hourly rate limit's default importance floor (0.7). A character writing quickly will drop them first. That is the intended trade, and it means consistency is weakest exactly when a scene is busiest.
4. **A correction in a later turn does not remove the old telling.** The later turn records the admission as its own memory, and narration outranks memory in the prompt, but both rows stay.
5. **Models differ on how freely they fill in.** Claude declined to invent a shared day; GPT-5 invented one without searching first. Neither broke a rule about {{user}}, but "search first" (D2) held on only two of four models when the search was going to come up empty.
6. **Not evaluated:** Google models; assistant characters under load (C3); long-running chats; the Optimizer's sanitizing signal; the generator direction.

### 13.5 Retellings (added 2026-11-18)

**The defect.** After telling the boathouse account twice, the DeepSeek runner held two rows that said the same thing. Admission had scored the second between `related` (0.70) and `reinforce` (0.85) and inserted it linked. A retelling is reworded and extended with small detail, which is enough to keep two long sentences under the reinforce line. Lowering the threshold for this category was rejected: two different accounts on one subject ("the boathouse deed is in Gaunt's name", "the warehouse deed is in Pike's name") sit in the same band, and folding them would lose one.

**The fix is at extraction, where the comparison can be made on the particulars.**

- `ExtractionContext.priorTellings(holderId)` reads the holder's 40 most recent memories that carry the `stated particulars` keyword (`MemoriesRepository.findRecentWithKeyword`), memoised per unit of work, empty on any failure.
- `selectPriorTellings` (`prompts/self.ts`, pure, no embeddings) keeps those sharing at least two distinctive words with the exchange, most shared first, at most six, each cut to 500 characters. A retelling repeats its own names and figures, so word overlap is enough to find it.
- The prompt gains an `ALREADY TOLD by the subject` footer after the canon block, at the very end so the cached prefix does not move. It tells the extractor to record nothing for the same account, and to record a changed account as a replacement: "I told Sam the deed is in Josiah Pike's name, where I had earlier told him Amos Cottrell."
- With nothing relevant the footer is absent and the prompt is byte-identical. A call that does not ask for stated particulars never reads or shows them.
- Admission is unchanged.

**Limits.** Only the 40 most recent tellings are read, so an account older than that can still be recorded again. Tellings stored before this change carry no keyword and are not found; in practice that is only the handful made in V4test earlier the same day.

**Rerun.** Two fresh archivists and two fresh runners (DeepSeek, GLM) each told their account in one chat and again in a second. All four retold the same particulars, and each holds **one** row, with a reinforcement count of 2.
