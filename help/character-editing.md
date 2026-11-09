---
url: /aurora/:id
---

# Editing Characters

> **[Open this page in Quilltap](/aurora)** — then choose a character

Every character in Quilltap keeps a single residence: one page, reached by clicking the character anywhere in Aurora, on which they may be both admired and amended. There is no separate "view" and "edit", no mode to enter, no grand **Save** button to remember at the end of the evening. You simply change a thing, and the thing stays changed — rather like a well-run household, in which the staff tidy up after you before you have quite finished making the mess.

## Reaching the Page

- From **Aurora** (`/aurora`), click any character's card or row
- From anywhere else that mentions a character — a group's roster, the home page, a search result — follow the link

Old bookmarks to a character's "view" or "edit" page still work; they are quietly redirected to the right section of the one page.

## The Header

Across the top, holding its place as you scroll, sits the character's calling card:

- **The avatar**, as tall as the header itself — the largest the portrait appears anywhere short of opening it in a picture viewer — is a menu: **Choose from photos…** (pick from the character's gallery), **Upload…**, or **Generate portrait…** (which opens the [Wardrobe](wardrobe.md) dialog, where portraits are painted in whatever the character happens to be wearing).
- **The name**, and beneath it the **title**, **pronouns**, **age** (when they have a birthday), a **Roleplay** or **Assistant** badge, and badges for **NPC**, **User-controlled**, **Carina** and **Archived** when any of those is so.
- **Alias chips** and **group chips**. Group membership is arranged on the group's own page; each chip carries a **Manage ↗** link there.
- **A line of figures** — memories, conversations, wardrobe items, inventory objects (and how many of them are carried by default), archetypes and kits, photos, scenarios, knowledge, core files, character files — every one of them a link to the place it counts. Memories and conversations lead to **History**, opening the list in question; wardrobe opens the Wardrobe; the four inventory figures open the Inventory; photos lead to **Appearance**, with the album opened; scenarios to **Prompts**; knowledge and core open the vault in the Scriptorium; character files lead to the **Vault** card on **Details**.
- **Start Chat** — the one primary button.
- **Generate ▾** — the three errands that write *into* the character with an LLM: **AI Wizard…**, **Refine from memories & instructions…** (the [Character Optimizer](character-optimizer.md)), and **Non-Quilltap prompt…** (the [external prompt generator](character-external-prompt.md)).
- **⋯** — the matters of life and estate: **Export…**, **Convert to NPC** (or **Convert to character**), **Archive…**, **Delete…**.
- **⭐** — marks the character a favourite in the lists.
- **The save chip** — the one place that reports how your edits are faring (see [How Saving Works](#how-saving-works)).

An **archived** character's page is shown read-only, with **Rehydrate** standing where **Start Chat** would be. Nothing may be changed until they are brought back.

## The Six Sections

Beneath the header lie six sections, each a tab. Every one has its own address, so you may bookmark or share a link straight to it: `/aurora/<id>?section=details`, and so forth.

| Section | The question it answers | What lives there |
|---|---|---|
| **Details** | Who are they? | Facts, the Dossier (with Template tools), Progressions, the Vault |
| **Prompts** | What are they told, and on what stage? | System prompts, Subprompts, Scenarios |
| **Appearance** | What do they look like, and what do they wear? | Photos, Physical description, Depiction guidelines, Wardrobe, Inventory |
| **Abilities** | What may they do, see and be? | Trust & perception, Tools & talents, Wardrobe & inventory, Control |
| **Chat Defaults** | How does a new chat with them begin? | Connection profile, partner, image profile, timestamps, agent mode, help tools |
| **History** | What has happened to them? | Conversations, Memories, Bulk edits, LLM logs |

## How Saving Works

The rule of the house is short: **a control saves itself, and only a dialog has a Save button.**

- **Selects, toggles, stars and tag chips** save the moment you change them.
- **Short text** — name, title, an alias, pronouns, birthday — saves when you leave the field or press **Enter**.
- **Prose** — the Dossier fields and the physical description — saves after about a second and a half of quiet while you type, and again when you leave the field. It never saves on every keystroke.
- **Anything still pending** is sent when you switch to another tab or leave the page.
- **Dialogs** — a system prompt, a subprompt, a scenario, a progression, a memory — keep their own **Save** buttons, as dialogs should.

There is no edit mode, no **Save Character** button, and no **Cancel**. The chip in the header keeps you informed:

- **All changes saved** — the ledger balances.
- **Editing — saved when you leave the field** — you are mid-sentence; nothing is lost.
- **Saving…** — the clerk is at the counter.
- **Could not save *Field* — Retry** — something went amiss. Your text stays exactly where you left it, the field is outlined, and **Retry** sends it again. Quilltap never quietly throws your words away.

**The name is required.** Empty the Name field and it is not saved; it shows an error until you give the character something to be called.

**Undoing a slip.** While you are still in a field, your editor's ordinary undo (Cmd+Z or Ctrl+Z) works as you would expect. Once a change has been saved there is no version history, so for a major rewrite it is prudent to copy the old text somewhere safe first — or to remember that every field is also a file in the character's vault, which you may keep under your own version control if you are that sort of person.

## Details

### Who Is Being Spoken To

Before putting pen to any field, pause for one question of etiquette: *who will be reading this?* Every field is delivered to somebody, and the graceful thing is to address that somebody directly.

- **Fields only the character themselves ever reads** — the Manifesto, the Personality, the System Prompts — are written *to* the character, as one might leave instructions for a trusted colleague. Written as: *You do not lie to Charlie, not even kindly.* / *You keep your worry behind your teeth. You have never once asked for help first.* / *You are Ariadne. You answer plainly and you never flatter.*
- **Fields only *other* characters ever read** — the Identity and the Description — are written *about* the character, from the outside, as an observer would put it. Written as: *Ariadne is a research librarian at the Athenaeum, known for finding what others gave up on.* / *She finishes other people's sentences, then apologises for it.*
- **Physical Descriptions** are addressed to no one at all — bare descriptive phrases, because the very same text is handed to the image generators, which want nouns, not sentences about "you". Written as: *auburn hair cut short; grey eyes; a scar across the left knuckle*.
- **Scenarios** are scene text, addressed to nobody — a stage set, not a letter. Written as: *The reading room is empty at this hour, rain against the high windows.*
- **Example Dialogues** need no such fuss — the `{{char}}:` / `{{user}}:` format carries the shape on its own.

The assembled system prompt addresses the character directly throughout, and each field's wrapper makes its vantage point plain — so text written for the right reader lands exactly where it should. An empty field shows its hint and a "Written as:" worked example as a placeholder, so the reminder is right where you are about to write.

### The Facts Card

**Name**

- Required. Used everywhere the system refers to the character
- Saved when you leave the field; an empty name is refused with an error rather than saved
- For a rename that should also sweep through memories and old conversations, use **Rename / Replace** on **History** instead (see [Bulk Edits](#bulk-edits))

**Title**

- Your private label for the character — your own framing, not a public title. Think "the protagonist", "the rival", "the one who keeps borrowing the cat"
- Optional, never shown to other characters

**Aliases**

- Other names the character answers to, added as chips. They appear beneath the name in the header

**Pronouns**

- Choose a preset or enter your own. When set, they are included in system prompts so the LLM uses them correctly, and shown in the header

**Birthday**

- Optional. A real date of birth, chosen from the date picker and kept as `YYYY-MM-DD`
- Set one and the character has a definite age, reckoned afresh every day — a year older on each birthday, with nobody lifting a finger. The card shows the age beside the picker, and the header shows it beside their pronouns
- Leave it empty and their age is whatever the prose says, as it always was
- Counted on the wall clock and the instance calendar, never a chat's story date: a birthday belongs to the character in every room at once. Someone born on 29 February turns a year older on 1 March in ordinary years
- Clear it with the **Clear** button beside the picker

**Kind of character**

- **Roleplay character** (the default) is a player in the drama: a person inside the story, with stakes of their own, who feels what happens and acts on it
- **Assistant** is a member of the staff: a capable aide whose business is doing work for you, such as research, drafting or keeping the books
- The choice is about how the character is *performed*, not what they are in the story. A ship's mind or a household automaton who lives in the scene is still a roleplay character
- With [Agent Mode](agent-mode.md) on, a roleplay character uses their tools as things they do in the scene and still answers in prose; an assistant researches, verifies and delivers a finished report
- Every character begins as a roleplay character, including every character made before the choice existed

**Tags**

- Add or remove tags as chips; each change saves at once. See [Tags](tags.md)

### The Dossier Card

Six Markdown editors, and the editors *are* the view: a filled field reads as handsome prose, an empty one shows its hint as an invitation. Inside them, `{{char}}` and `{{user}}` tokens — and the character's own name and their default partner's — are tinted, so you can see at a glance where a token stands or might stand.

**Identity**

- The shallow first impression — what a stranger could know on sight or by reputation. Name, station, occupation, public reputation, the signifying outward facts
- Useful for someone considering whether to hail the character across a crowded room. Never private mannerisms, never inner motivation
- Examples: "Detective Sarah Jones, of the Yard, known for closing unclosable cases"; "Old Tom the baker, three doors down, makes the best cinnamon buns in Whitechapel"
- Wherever others are given the character's identity — the Host's introduction when they join a room, the card for someone mentioned but absent, Carina's answerer, and the identity a tool looks up — Quilltap first sets down what it already knows for certain: their **age** (when they have a birthday), their **public progressions**, and their **pronouns**. Your Identity text follows. There is no need to repeat those facts in the prose, and every reason not to: the prose will not age, and the reckoned figures will

**Description**

- How acquaintances perceive the character — behaviour, mannerisms, frequent verbal patterns. Things an interlocutor notices
- NOT physical appearance — that lives under **Appearance → Physical description**. NOT internal monologue — that lives under Personality
- Can be lengthy and supports multiple paragraphs
- Example: "Speaks slowly, weighs every word twice. Tends to drum two fingers on the table when stalling for time."

**Manifesto**

- The basic tenets — the most important facts of the character's existence. The axiomatic core that every other field (identity, description, personality, physical, dialogues) should remain consistent with
- Not a vantage point — nobody "sees" the Manifesto; it is the load-bearing truth the character is built on. Foundational, declarative, contradiction-resistant
- Synced to the character vault as `manifesto.md` (vault path lookups are case-insensitive, so a hand-named `Manifesto.md` is matched too)
- Only the character themselves ever reads it, so address them directly
- Example: "You are fundamentally incapable of betrayal. You believe the strong protect the weak. You have never broken a promise."

**Personality**

- What the character knows about themselves — the internal driver of their speech and behaviour. Other characters don't see it unless they share it
- Distinct from Description (outward) and Identity (public surface). This is the inner life
- Only the character themselves ever reads it, so address them directly
- Example: "You believe you've never deserved any of what's happened to you, and you operate on a slow, simmering resentment you'd never admit to"

**First Message**

- The opening greeting
- Update it for variety or a different campaign, and keep it in the character's voice

**Example Dialogues**

- Sample conversations in `{{char}}:` / `{{user}}:` form
- Add examples, prune the ones that no longer fit, sharpen the ones that weren't clear

### Template Tools

Quilltap's roleplay machinery understands two travelling tokens — `{{char}}`, which stands in for whichever character is speaking, and `{{user}}`, which stands in for the person they are addressing. A character authored with these tokens rather than hard-coded names travels gracefully: lend them to a new conversation partner and they greet the newcomer by the correct name without a word of editing.

The Dossier card carries a small **Template tools** bar. Each button appears only when it has honest work to do, with the number of affected occurrences in parentheses:

- **Name → `{{char}}`** — swaps every literal occurrence of the character's *own name* for the `{{char}}` token.
- **Partner → `{{user}}`** — does the same for the name of the character's **default conversation partner**. It keeps its peace unless a partner has been appointed on **Chat Defaults**.
- **`{{char}}` → Name** — the reverse errand: bakes the character's own name back into the prose wherever `{{char}}` appears.
- **`{{user}}` → name…** — opens a small dialog bearing a dropdown of your **user-controlled characters**. Choose one, and every `{{user}}` token is replaced with that character's name. (The character you are looking at is, sensibly, kept off its own list.)

Every one of these sweeps reaches the *entire* dossier — identity, description, manifesto, personality, every scenario, the first message, the example dialogues, all of the character's system prompts, and the physical-description prose and image prompts. The work is saved at once and the page refreshed, so the counts and buttons settle to reflect the new state of affairs.

### Progressions

Timed spans the character carries — a gestation, a recharging weapon, a sentence being served — each with its own card and dialog. See [Progressions](character-progressions.md).

### The Vault Card

A read-only card, and the first door from the character's page into their vault. It names the vault (a link into the Scriptorium), counts what sits in its **Core**, **Knowledge**, **Scenarios**, **Subprompts** and **Mail** folders, and reports how many of the character's managed files are present — naming any that have gone missing. Nothing on this card writes; it is there so that you know where everything lives.

### The Metadata Card

Lists the keys you have filed in the character's `metadata.json` fact sheet, and offers **Edit metadata.json…**, which opens the sheet as JSON in a dialog of its own with a proper **Save** (the one kind of Save this page keeps — see [How Saving Works](#how-saving-works)). Whatever you write must be a JSON object; anything else is politely refused with the reason, and nothing is saved. The reserved `progressions` key is kept out of the editor altogether and carried across untouched when you save, so the Progressions card's work is never trampled. The button stays dim until the character has a vault.

### Living Properties from the Scriptorium

Each character carries a private vault in the Scriptorium — a small database-backed document store seeded at creation with your character's identity, personality, wardrobe, and a small, tidy cluster of files that mirror the fields on the character's page. Those files are the character: the version you see in chats, on the roster, in image prompts, and in every other corner of the application comes straight from the vault, and every save from the page — or from an import, an API call, or the Optimizer — is written back into the matching file.

**The files and what each one governs:**

| Vault file | What it holds |
|---|---|
| `properties.json` | **pronouns**, **birthday**, **aliases**, **title**, **first message**, **talkativeness**, **kind** (`roleplay` or `assistant`), and the outfit and diagram settings |
| `metadata.json` | The character's **fact sheet** — a flat object of keys you invent yourself, answering to no field on the page. See the note below. |
| `identity.md` | **Identity** (the surface, outside-view prose field) |
| `description.md` | **Description** (the acquaintance-view prose field) |
| `manifesto.md` | **Manifesto** (the axiomatic-core, load-bearing-truth prose field) |
| `personality.md` | **Personality** (the inward, self-knowledge prose field) |
| `example-dialogues.md` | **Example Dialogues** (style samples for the LLM) |
| `physical-description.md` | The **Full Description** of the character's physical description |
| `physical-prompts.json` | The **head-and-shoulders / short / medium / long / complete** prompts of the physical description (JSON with `headAndShoulders`, `short`, `medium`, `long`, `complete` keys), plus the **Humanoid** setting as `humanoid` (`true` or `false`; absent reads as `true`) |
| `Prompts/*.md` | The character's **System Prompts** — one file per named variant, with YAML frontmatter carrying `id`, `name` (required) and an optional `isDefault: true` |
| `Scenarios/*.md` | The character's **Scenarios** — one file per scene, with the first `# heading` as the title and the body beneath as the context. A YAML frontmatter block above the heading carries the scene's `id`, and may add `description` and `archived: true` |
| `Wardrobe/*.md` | The character's **Wardrobe Items** — one Markdown file per garment, with frontmatter carrying `title`, `types`, an optional `imagePrompt`, an optional `componentItems` list (for a composite ensemble), `appropriateness`, the `default` and `replace` flags, and timestamps; the body beneath is the freeform description |

Edit any of these files in the Scriptorium, save, reload the character, and the new values appear throughout the app without any further ceremony. Should `properties.json` — the keystone — go missing or turn unreadable, the character cannot be loaded until it is repaired; Quilltap would rather tell you than quietly present a hollow likeness. See [When the Vault Is in Disarray](#when-the-vault-is-in-disarray), below.

**A note on `Prompts/` and `Scenarios/`.** Each file is one prompt or one scene, and each is written on its own: saving a prompt touches that prompt's file and no other, and a file of your own in either folder — a draft without frontmatter, a scene whose body you have not yet written — is never swept away by a save. Prompt files require YAML frontmatter naming them; a file that lacks frontmatter (or a `name` field) is quietly skipped while its siblings carry on. Scenario files want a `# Scenario Title` at the top, though if one is missing Quilltap will use the filename (without the `.md`) rather than drop the file entirely. Each prompt and scene carries its own `id` in its frontmatter, so renaming one — in the page or in the Scriptorium — keeps its identity: a chat that chose that prompt, or a character whose default scenario it is, still finds it afterwards. A file written by hand without an `id` takes one from its place in the vault, and is given it in writing the next time it is saved.

## When the Vault Is in Disarray

Should a character's vault fall into a state Quilltap cannot read — `properties.json` missing, or present but no longer valid JSON, or holding a value it will not accept (a talkativeness of nought, say) — the character's page shows, in place of the character, an inventory of the vault: each of its principal papers, whether it is there, whether it reads, and, for one that does not, the reason in plain words.

- **Missing papers** — `properties.json` or `metadata.json` — may be restored with the **Restore** button, which lays down a fresh copy at its factory settings and touches nothing else whatever.
- **Papers that are present but will not read** are never rewritten on your behalf. They hold the character's only copy of what they say, and a well-meaning repair that wrote defaults over them would cost you the character. Open the vault in the [Scriptorium](mount-points.md), mend the file by hand (the inventory tells you what is wrong with it), and press **Look again**.

The character still appears in Aurora's list while their papers are in this state, so you can always reach the inventory; it is only their own page (and conversations that would need their settings) that waits on the repair. The same discretion governs Quilltap at start-up: it will furnish a missing `properties.json` or `metadata.json`, but a present file it cannot read is reported — in the log and in the [Almanack](the-almanack.md) — and left exactly as it was found.

**A note on `metadata.json` — the fact sheet.** Every other file in the vault answers to some field on the character's page. `metadata.json` answers to nothing at all: it is a single JSON object of whatever keys you care to invent, and Quilltap has not the faintest opinion about any of them.

```json
{
  "hasAnsibleAccess": true,
  "clearanceLevel": 3,
  "faction": "Ordo Aurum",
  "knownLanguages": ["Trade Cant", "High Gothic"]
}
```

Booleans, numbers, strings, lists, nested objects — any JSON value is welcome, and no schema is imposed on any of it; the only general rule is that the file must hold an **object** (a `{ … }`), not a list or a bare value.

There is now exactly **one reserved key**: `progressions`, which holds the
character's timed spans — a gestation, a recharging weapon — and *is* checked
for shape. See **[Progressions](character-progressions.md)** for what goes in
it and the editor that spares you writing it by hand. Every other key remains
entirely yours, as it always was; an entry under `progressions` that Quilltap
cannot read is dropped by itself, leaving the rest of your sheet undisturbed.

A few points of etiquette worth knowing:

- **You are the only author.** No generation system will ever write here — not character creation, not summoning from lore, not the optimizer. Nothing invents a fact about your character behind your back, and nothing tidies away a key you meant to keep.
- **It is not a prompt field.** The raw fact sheet is never injected into any character's context. A model does not read your character's clearance level merely by being your character; it must go and look, like anyone else. The single sanctioned exception is the reserved `progressions` key, whose *derived* report — "you are 20 weeks along" — is the whole purpose of that key; the stored timestamps themselves are still never shown.
- **It is an ordinary vault file for all that.** A character with **system transparency** enabled may read — and edit — `metadata.json` through the `doc_*` tools, their own and their tablemates', exactly as with any other document in the vault. An opaque character cannot see it at all: like every root-level file in her own vault, it is part of the locked core (see [System Transparency](character-system-transparency.md)). No new permissions, no special cases.
- **Its absence is not a fault.** Characters created before the fact sheet existed simply have no such file, and Quilltap reads that as an empty sheet rather than a broken vault. New characters are seeded with `{}`. Should the file ever fail to parse — a comma out of place at midnight — the sheet reads as empty for that reading and a warning goes to the log; the rest of your character is entirely undisturbed.
- **The page saves only the keys you changed.** The Metadata card and the Progressions card each send just their own keys, merged into the sheet on the server, so neither can undo the other's work, nor a key a character or a custom tool added in the meantime. (A whole-object `metadata` write through the API still replaces the sheet entire; editing the file by hand does exactly what you'd expect.)
- **The editing desk depends on the key.** Progressions have their own card on **Details**, described in [Progressions](character-progressions.md). Everything else is edited on the **Metadata** card, just below the Vault card on **Details** (see [The Metadata Card](#the-metadata-card)) — or, if you prefer, by opening the vault in the Scriptorium and writing the JSON directly.

**What it is for.** The fact sheet exists so that [custom tools](custom-tools.md) may consult it: an outcome table can branch on `hasAnsibleAccess`, so the same lock opens for the character carrying the key and stays shut for everyone else. Anything else you file there is yours to use as you see fit.

**A note on example dialogues.** An *empty* `example-dialogues.md` is a perfectly valid state — it means "no examples," and Quilltap treats it accordingly.

**A note on the wardrobe.** The whole of the character's wardrobe keeps to a single folder, `Wardrobe/`, which holds one Markdown file per item — garments and grand ensembles alike. The frontmatter carries the `title`, the `types` list (one or more of `top`, `bottom`, `footwear`, `accessories`, `hair`), an optional `imagePrompt` (the Portrait Cue: a short, literal phrase whispered to the portraitist and the Lantern *in place of* the title, since the prose description below is written for human eyes and never reaches the easel), an optional `appropriateness` tag, the `default` flag, and the timestamps; the body of the file is the freeform description, written however you please. A `hair` item is a *hairdo* — a braid, an updo, a wig — and not the hair itself, whose colour and length belong to the physical description.

A **composite** — an ensemble bundling other items, such as a "Rain Outfit" of raincoat, jeans, and boots — is an ordinary wardrobe file with one addition: a `componentItems` list naming its pieces, where each entry is an item *slug* (the kebab-cased title, e.g. `blue-tweed-jacket`) and a raw UUID is accepted as a fallback for pieces the slug map can't place. A composite may also carry `replace: true`, meaning that donning it first empties the slots it designates rather than layering atop what is already worn. Should you contrive a circular bundle — an ensemble that, by some route, contains itself — Quilltap declines to chase its own tail: the offending item's component list is emptied and a note goes to the log, though the item itself survives unharmed, your hand-edits being too precious to discard wholesale. A component naming something that isn't in the vault is likewise dropped from that one list, with a warning, and the rest of the bundle proceeds undisturbed.

The old `Outfits/` folder of saved presets is **retired**. Composites do that work now, and Quilltap no longer reads that folder at all — any stale `Outfits/*.md` files still lying about are simply ignored.

Adding a new item, then, is as easy as dropping a fresh `.md` file into `Wardrobe/` with `title:` and `types:` in the frontmatter; the system fills in the `id` and timestamps on its next sync. Items marked with `archived: true` (or carrying a non-null `archivedAt`) are filtered out of the normal list. The Salon sidebar, the wardrobe tools the LLM reaches for, and every other consumer read their lists from this folder.

## Prompts

### System Prompts

System prompts tell the AI exactly how to behave. A character may keep several, each with its own name, and each opened, previewed, imported, edited or deleted from the **System prompts** card. The **★ star** beside a prompt is the one and only control for which prompt is the default — click another prompt's star and the honour passes to it at once. See [Character System Prompts](character-system-prompts.md) for the full particulars.

**Example:**

```
You are Captain Vex, a hardened pirate captain with a hidden code of honor.
You speak with a pirate dialect, dropping g's (talkin', fightin'). You're
strategic and cunning but never harm innocents. You're intensely loyal to
your crew. Respond always in character as Captain Vex, maintaining this
perspective and personality.
```

**Editing one:**

1. Open **Prompts**
2. Click the prompt's pencil to open its dialog
3. Make your changes
4. Click **Save** in the dialog

**Tips:**

- Start with the existing prompt; enhance rather than replace
- Keep it focused on key behaviours
- Be specific about communication style
- Avoid contradictions

### System Prompt Structure

Well-organized system prompts have this structure:

```
1. Identity: You are [Character Name], [Basic Description]

2. Personality: [Key traits, how they think and feel]

3. Communication: You speak [in what style/accent/tone]

4. Values/Priorities: [What matters to them, what drives them]

5. Constraints: [What they wouldn't do, boundaries]

6. Instructions: [How to respond, maintain character, etc.]
```

### Example System Prompt Refinements

**Original (basic):**

```
You are a detective. Act like a detective.
```

**Refined (better):**

```
You are Detective Sarah Chen, a 15-year veteran homicide detective.
You're analytical and detail-oriented. You speak directly, no nonsense.
You care deeply about victims but hide it behind professionalism.
You have dark humor about your work. You ask probing questions and
notice small details others miss. Stay in character as Sarah always.
```

### Multiple System Prompts

If your character has different modes, create a prompt for each — "When speaking to allies…", "When speaking to enemies…", "When alone…". You can switch between them in a chat from the participant card, and the starred one is used whenever nobody says otherwise.

### Subprompts

Smaller, per-chat instructions kept on their own card. See [Subprompts](character-subprompts.md).

### Scenarios

- A collection of named scenes, each with a title and descriptive content
- A character may accumulate any number of scenarios as their story progresses — one for the tavern, one for the road, one for that regrettable business in Marseille
- **+ Add Scenario** opens a dialog with a title and a Markdown body; the pencil on a row opens the same dialog, filled in; the bin removes the scenario for good
- The **★ star** on a row makes that scenario the default — the one a new chat with this character opens on unless you pick another. Click the star again to withdraw the honour
- **Archive** a scenario that has served its turn rather than deleting it. It stays on the card, wearing a small **Archived** badge and offering **Restore**, but it withdraws from the Starting Scenario drop-down wherever chats are begun — the new-chat form and the Salon's own picker alike — until somebody there ticks **Show archived**. Conversations already playing out in that scene are untouched, since the text was woven in at their creation. Marseille need not be forgotten; it need merely be put away
- Deleting the default scenario leaves the character with no default, rather than pointing at a scene that no longer exists

## Appearance

### Photos

The character's photo gallery: upload pictures, browse them, set one as the avatar, delete what you no longer want. The **Photo Album** arrives folded shut, as do the **Avatar Rolls** and **Wardrobe Pictures** beneath it, each showing its count; click a heading to open it. The header's photo figure opens the album for you. See [Character Gallery](character-gallery.md).

### Physical Description

A character has exactly one physical description — so it wants neither a name nor a note on when to wear it, and has neither. It helps the AI understand the character's appearance, keep it consistent across conversations, and give the image generators something accurate to paint from. There is no **Save** button on this card: each text field saves itself as the Dossier fields do, and **Humanoid** saves the moment you tick or untick it. **Clear** (behind a confirmation) empties the description entirely — the full description and every image prompt — leaving only the **Humanoid** setting as it was.

**Humanoid, or Otherwise**

Above the prompts sits a **Humanoid** checkbox, ticked by default. Untick it for a character who has no body to speak of — no head, no shoulders, no limbs — such as a clockwork of interlocking spheres or a drifting lattice of light. Once it is unticked:

- **Avatars** are painted with the whole of the creature's form in frame rather than a head-and-shoulders crop, and the portraitist is told plainly that there is no head, face, neck, shoulders, torso or limbs to be had and nothing is to be anthropomorphised. The avatar takes its description from the **Medium** prompt (then Long, Short, Complete, Full); the Head & Shoulders prompt is ignored, and the overnight errand that writes one for each character passes this character by.
- **Pronouns stop deciding the figure.** A non-humanoid "he" is no longer painted as "a man"; every image prompt calls it a non-humanoid entity instead.
- **Wardrobe pictures** show any worn item resting upon the creature's form — never a full-length figure standing on legs it hasn't got.
- **The Lantern's scenes** and **the image tool** carry the same instruction for this character whenever it appears among a cast.
- **In chat**, the character's own Physical Appearance section reminds it that it has no humanoid body, lest it shrug shoulders it does not possess.
- **The Character Optimizer** will not suggest a Head & Shoulders prompt for it, nor give any variant a body part it lacks.

The setting lives in the vault's `physical-prompts.json` as `"humanoid": false`; a file without the key reads as humanoid. Regenerating the descriptions with the AI Wizard or the Optimizer leaves the setting as you left it.

**The prompt variants**

**Head & Shoulders** (used for avatars)

- The prompt the avatar generator reaches for first, since an avatar is a head-and-shoulders crop
- Describe only what such a crop reveals: face, hair, expression, neckline, and any visible upper attire — never the chest, waist, hips, legs, or other anatomy below the shoulders
- **Hair, but not hairdressing.** Its colour, length, and texture belong here; a deliberate *style* — a braid, an updo, a wig — belongs in the wardrobe's [Hair slot](wardrobe.md) instead, so the character may put it up and take it down without you rewriting their person
- Keeping it above the collar also keeps image-provider moderation from balking at a portrait it would otherwise refuse
- Example: "Young woman, glossy jet-black wavy hair from a center part, deep brown almond eyes, warm wheatish skin, high cheekbones, a warm closed-lipped smile, pearl stud earrings, open collar of a deep-wine field shirt"

**Short Description** (1 sentence) — a quick visual reference. Example: "Tall woman with dark red hair and green eyes"

**Medium Description** (2–3 sentences) — balanced detail. Example: "Tall woman with long dark red hair, sharp green eyes, pale skin. Wears practical leather clothing." (The braid she usually wears it in is a wardrobe Hair item, not part of her person.)

**Long Description** (1 paragraph) — detailed, good for image generation.

**Complete Description** (2–3 paragraphs) — very detailed, for generating many variations.

**Full Description** (extensive) — the complete freeform account, from which the shorter prompts above may be written.

### Depiction Guidelines

The Ariel Clause: the character's standing conditions on how they may be shown, kept as `depiction-guidelines.md` in their vault and saved as you write. See [Image Aesthetics](image-aesthetics.md).

### Wardrobe

**Open wardrobe** brings up the [Wardrobe](wardrobe.md) dialog, where items are made, worn and painted. The card also holds the character's **wardrobe instructions** and a summary of what is within their reach — their own items, their groups', and Quilltap General's. Whether they dress themselves, create outfits, or choose their own opening outfit is settled on **Abilities**.

### Inventory

**Open inventory** brings up the objects the character carries, and the card lists what they carry by default when they arrive in a chat. Whether they may manage it themselves is settled on **Abilities**.

## Abilities

Every switch about the character's powers, in four cards, each saving the moment you change it. Where a setting may **Inherit**, the option tells you what it presently resolves to, so you need not go hunting through Settings to find out.

- **Trust & perception** — **System transparency** (see [System Transparency](character-system-transparency.md)) and **Aurora's Core whisper** (inherit, always or never).
- **Tools & talents** — **Can answer @-queries (Carina)** (see [Carina](carina.md)) and **Draws diagrams**, with its **Drawing style** of **Hand-drawn** (the default) or **Clean**, greyed out but remembered while the pen is withheld (see [Diagrams](diagrams.md)).
- **Wardrobe & inventory** — **Dresses themselves**, **Creates outfits**, **Chooses own opening outfit**, **Manages inventory**.
- **Control** — **You play this character** (the character is user-controlled: you speak for them) and **Non-player character** (an NPC).

## Chat Defaults

The settings a new chat with the character begins with — exactly what the New Chat dialog fills in for you, each saved on change:

- **Connection profile** — which LLM speaks for them, or **User Acts As Character**
- **Conversation partner** — the default `{{user}}` (greyed out, with a note, while you play the character yourself)
- **Image generation profile**
- **Timestamps**
- **Agent mode** default
- **Help tools** default

## History

- **Conversations** — every chat the character has appeared in
- **Memories** — the character's Commonplace Book, each memory opened and saved in its own dialog. See [Memory Maintenance](memory-maintenance.md)

Conversations and Memories both arrive folded shut, their counts beside their headings; click a heading to open the list. Once open, each shows one page at a time — ten conversations, thirty memories — with **← Previous** and **Next →** at the foot and a note of where you stand, rather than growing ever longer as you scroll. A search or filter returns you to the first page.
- **Bulk edits** — **Search & Replace** and **Rename / Replace**, side by side (below)
- **LLM logs** — folded away at the foot of the page until you want them

### Bulk Edits

Both tools rewrite history, so both open their own dialog and show you a preview before anything is touched.

**Search & Replace** finds a word or phrase across the character's chats and memories and replaces it, after showing you what it found.

**Rename / Replace** conducts a wholesale renaming — a careful sweep that follows a name (or any turn of phrase) clear across the character's entire estate.

A single sweep visits the character's own dossier (the name itself, title, identity, description, manifesto, personality, every scenario, the first message, the example dialogues, the aliases, and all of the character's system prompts), the physical-description prose together with its short/medium/long/complete image prompts, every one of the character's memories, and — most far-reaching of all — the titles and the actual message bodies of every conversation the character has ever appeared in. Messages authored by the Staff (the Lantern, Aurora, the Host, and their colleagues) are left untouched, since their wording is bookkeeping rather than prose.

**Renaming the character**

1. On **History**, under **Bulk edits**, click **Rename / Replace**.
2. Type the **New Name**. The **Current Name** is shown beside it, fixed, for reference.
3. Tick **Case sensitive matching** only if the capitalisation must match exactly.
4. Click **Preview Changes**.

**Replacing nicknames, aliases, or any other term**

Beneath the rename, the **Additional Replacements** section takes any number of find-and-replace pairs — splendid for nicknames, an old surname, or a wholesale change of setting. Click **Add**, fill in **Find** and **Replace with**, and toggle the **Aa** box on a row that ought to mind its capitals. You may rename the character, supply additional replacements, or both in the one pass.

- Find: "Snips" → Replace with: "Ace" (an outdated nickname)
- Find: "pirate ship" → Replace with: "airship" (changing the genre)
- Find: "London" → Replace with: "New York" (changing the setting)

**Always preview first.** **Preview Changes** commits nothing. It lays out a tally — how many occurrences fall under character fields, descriptions, memories, chat titles, and messages — and a table showing each `before → after`, with surrounding context. Read it over; only then click **Execute *N* Replacements** and confirm the dialog. The change cannot be undone, so the preview is your safety net.

Once executed, any conversation whose messages were altered is re-indexed for search behind the scenes, so the Scriptorium's archive reflects the new wording rather than the old.

## Editing Workflow: Common Scenarios

### Character Acting Wrong in Chats

1. Identify the specific behaviour
2. On **Prompts**, open the default system prompt and add a specific instruction:

   ```
   "Do NOT break character to explain yourself. Stay as [Character] always."
   ```

3. Save the dialog and test in a new chat

### Updating a Character for a New Campaign

1. On **Prompts**, add a new scenario with a title reflecting the new setting — rather than erasing the old one, let the character carry their history with them — and star it if it should be the new default
2. On **Details**, update the Description if time has passed or circumstances have changed substantially
3. On **Prompts**, add context about the new period to the system prompt
4. Optionally, revise the physical description on **Appearance**
5. Test in a new chat

The character's previous scenarios remain intact, available for flashbacks, parallel campaigns, or the sort of elaborate timeline shenanigans that make worldbuilders so very pleased with themselves.

### Adding Relationship Information

On **Details**, add to the Personality or Description:

```
"Close relationship with [Other Character Name]. Has tension with [Another Character]."
```

It saves as you type.

### Fixing an Accent or Speech Pattern

1. On **Prompts**, add a communication instruction to the system prompt:

   ```
   "You speak with a Southern accent. Drop g's from -ing words (talkin',
   fightin', walkin'). Use y'all and regional expressions naturally."
   ```

2. On **Details**, add Example Dialogues showing the accent in action
3. Test in a new chat

### Making a Character Darker or Lighter

1. On **Details**, adjust the Personality, the First Message if needed, and add Example Dialogues in the new tone
2. On **Prompts**, add a specific tone instruction:

   ```
   "Your responses have a dark, cynical tone tinged with dark humor."
   ```

3. Test in a new chat

## Advanced Editing Techniques

### Layered System Prompts

```
Core instruction: You are [Character]. You [core trait].

When speaking to allies: [behavior A]
When speaking to strangers: [behavior B]
When alone: [behavior C]

Always maintain: [core personality]
```

### Conflicting Traits

If the character has contradictions, explain them:

```
You are [Character], someone with seemingly contradictory traits:
- Appears tough but is deeply empathetic
- Speaks harshly but acts with kindness
- Seems confident but battles internal doubt

This contradiction is core to your character. Express both sides naturally.
```

### Prompt Testing

1. Start a new chat with the character (**Start Chat** in the header)
2. Try different conversation angles
3. See whether the behaviour matches your intent
4. Return to the page, adjust, and try again

## Best Practices

### Do's ✓

- Keep the sections consistent with one another
- Test changes in chats before you consider them finished
- Copy the old text somewhere safe before a significant rewrite
- Use the physical description for visual reference
- Keep system prompts focused and clear

### Don'ts ✗

- Don't overwrite character details without review
- Don't create contradictory instructions in a system prompt
- Don't remove important personality traits accidentally
- Don't skip the preview before a Rename / Replace

### For Complex Characters

- Keep each system prompt under 500 words
- Break very long descriptions into multiple sections
- Use a shorter first message (1–2 sentences)
- Keep example dialogues focused
- If the character has distinct modes, give each its own system prompt and keep the core personality consistent across them

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora/:id")`

## Related Topics

- [Character Creation](character-creation.md) — Creating new characters
- [Character System Prompts](character-system-prompts.md) — Deep dive on prompts
- [Subprompts](character-subprompts.md) — Smaller per-chat instructions
- [Diagrams](diagrams.md) — Letting a character draw in the Salon
- [Progressions](character-progressions.md) — Timed spans a character carries, reported each turn
- [Organizing Characters](character-organization.md) — Tags and management
- [Chats](chats.md) — Testing character in conversations
- [Characters Overview](characters.md) — About characters
