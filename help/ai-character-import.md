---
url: /aurora
---

# AI Character Import

> **[Open this page in Quilltap](/aurora)**

The AI Character Import tool — known affectionately as **Summon From Lore** — lets you generate complete characters from source material like wiki pages, story documents, character sheets, or freeform notes. Instead of manually copying fields into the character editor, an AI analyzes your source material and creates a fully-populated character with descriptions, system prompts, memories, and more.

## Accessing AI Character Import

1. Navigate to the **Characters** page (`/aurora`)
2. Click the **Summon From Lore** button in the toolbar
3. The wizard opens in a large dialog overlay

## How It Works

The wizard uses a multi-step AI approach:

1. Your source material is sent to the AI in focused calls, each extracting one aspect of the character
2. The AI generates character basics, dialogue, system prompts, physical descriptions, pronouns, and optionally memories and example chats
3. All generated content is assembled into Quilltap's native `.qtap` export format
4. The result is validated and imported through the standard import system

The AI never generates technical data like IDs or timestamps — those are handled programmatically, ensuring data integrity.

## Wizard Steps

### Step 1: Source Material

Provide the material the AI will analyze:

- **Upload Files** — Drag and drop or browse for `.txt`, `.md`, or `.pdf` files containing character information. You can upload multiple files.
- **Freeform Text** — Paste any additional character information, backstory, personality notes, or wiki content into the text area.

You need at least one file or some text to proceed.

### Step 2: Configuration

- **Connection Profile** — Choose which AI provider and model to use for generation. The default profile is pre-selected.
- **Generate Memories** — When checked, the AI extracts key facts and experiences as Commonplace Book memories. Default: on.
- **Generate Example Chat** — When checked, the AI creates a sample conversation demonstrating the character's voice. Default: off.

### Step 3: Generation

Watch the AI work through each extraction step:

| Step | What It Does |
|------|-------------|
| Analyzing Source Material | Summarizes large source documents (only for long texts) |
| Extracting Character Basics | Name, title, identity, description, personality, and an initial scenario (title and content) |
| Generating Dialogue | First message and example dialogue exchanges |
| Creating System Prompts | Instructions for AI roleplay behavior |
| Describing Appearance | Physical descriptions at 5 detail levels for image generation |
| Determining Pronouns | Subject, object, and possessive pronouns |
| Generating Memories | Key facts and experiences (if enabled) |
| Creating Example Chat | Sample conversation (if enabled) |
| Assembling Export | Builds the `.qtap` file |
| Validating Data | Checks data integrity |

Each step shows its status: pending, in progress, complete, or warning. Non-critical failures (like dialogue generation) won't block the import — only character basics are required.

### Step 4: Review & Import

Review the generated character before importing:

- **Character Summary** — Name, title, pronouns, and description preview
- **Generated Content** — Which fields were successfully generated and which had issues
- **Content Counts** — Number of memories, system prompts, and chat messages generated

Three actions are available:

- **Import Character** — Imports the character into Quilltap immediately
- **Add More & Regenerate** — Go back to Step 1 with existing material preserved, add new sources, and re-run generation. Only failed or missing steps re-run.
- **Start Over** — Clear everything and begin fresh

## Field Vantage Points

Summon From Lore distinguishes four character fields by *vantage point*. The AI is instructed not to mix them up — the same trait should not appear in two fields.

- **Identity** — outside view; what strangers know on sight or by reputation (name, station, occupation, public reputation). Never private mannerisms or appearance.
- **Description** — acquaintance view; behaviour, mannerisms, frequent verbal patterns. Never physical appearance — that lives in physical descriptions.
- **Personality** — internal view; the character's own self-knowledge, inner drivers, motivations, beliefs.
- **Physical descriptions** — appearance only; generated as a separate step in five detail levels.

If your source material describes a character's looks, those details flow into the physical descriptions, not into the description field.

## Tips

- **Better source material = better results.** Detailed wiki pages or character sheets produce more accurate characters than brief notes.
- **Use multiple files.** Upload a wiki page for backstory plus a separate document for personality notes.
- **Try different models.** If results are unsatisfying, try a different connection profile with a more capable model.
- **Iterate.** Use "Add More & Regenerate" to refine results by adding more context.
- **Memories improve roleplay.** Generated memories give the character knowledge to draw on during conversations.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Topics

- [Character Creation](character-creation.md) — Manual character creation
- [Character Editing](character-editing.md) — Editing character fields
- [Character Import & Export](character-import-export.md) — Other import/export methods
- [Connection Profiles](connection-profiles.md) — Setting up AI providers
- [Roleplay Templates Settings](roleplay-templates-settings.md) — Templates and prompts
