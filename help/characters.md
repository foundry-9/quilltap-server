---
url: /aurora
---

# Characters Overview

> **[Open this page in Quilltap](/aurora)**

Characters are the core of roleplaying in Quilltap. They represent personas that you can chat with, each with their own personality, background, and conversation style.

## What Are Characters?

Characters are AI-driven personalities you create and interact with. Each character has:

- **Identity** — A name, title, and unique personality
- **Background** — Detailed description, personality traits, and scenario
- **Configuration** — System prompts that guide how the character behaves
- **Profile** — Avatar image, tags, and organizational information
- **Relationships** — Connections to other characters and conversation partners
- **Chat History** — Record of all conversations with that character

Think of characters as personas you can have ongoing conversations with, where the AI maintains consistency with the character's defined personality and background.

## Character Types

Quilltap supports different character configurations:

### Control Mode

**LLM-Controlled (Chatbot)**

- The AI generates responses as the character
- You chat with the character like a conversation partner
- Best for: Interacting with characters, storytelling, roleplay
- Default mode for most characters

**User-Controlled (NPCs)**

- You decide what the character says and does
- Type responses as if you are the character
- Other characters respond to your character
- Best for: Direct character control, collaborative storytelling
- Labeled as "You Act As Character" in the UI

### Character Categories

**Regular Characters**

- Standard characters you create
- Can be LLM or user-controlled
- Organized on the main Characters page

**NPCs (Non-Player Characters)**

- Ad-hoc characters created on-the-fly in chats
- Often quick creations for single conversations
- Can be promoted to regular characters later
- Marked with "NPC" badge

## Accessing Characters

### Characters Page

1. Click **Characters** in the left sidebar
2. See list of all your characters
3. Click a character to open their page
4. Options to create new, search, filter, and manage

### Quick Access

- **Sidebar** — Recent/favorite characters may appear in sidebar
- **Search** — Find specific character by name
- **Filtered View** — Show only certain categories

## Character List View

The Characters page shows all your characters with:

- **Avatar** — Character profile picture
- **Name** — Character name and title
- **Description** — Short preview of character
- **Chat Count** — Number of conversations
- **Favorite Status** — Star icon for quick identification
- **Control Mode** — LLM or "You Act As" indicator
- **Tags** — Organization tags
- **Action Buttons** — Open, delete, start chat

### Sorting and Organization

Characters are sorted by:

1. **Favorites first** — Starred characters appear at top
2. **Chat frequency** — Most chatted-with characters first
3. **NPCs last** — Regular characters before temporary NPCs
4. **Then alphabetically** — By character name

### Quick Actions

**From character card:**

- **Open** — Go to the character's page, where everything is seen and changed
- **Chat** — Start new conversation
- **Favorite/Unfavorite** — Toggle star
- **Toggle Control Mode** — Switch LLM/User-controlled
- **Delete** — Remove character

## Understanding Character Attributes

### Identity

- **Name** — What the character is called
- **Aliases** — Optional alternate names the character goes by (e.g., "Liz", "Lizzy" for "Elizabeth")
- **Pronouns** — Optional pronouns for the character (e.g., he/him/his, she/her/her, they/them/their). Choose from presets or enter custom pronouns. When set, pronouns are included in system prompts so the LLM uses them correctly, and shown in the header of the character's page.
- **Title** — Optional subtitle or role (e.g., "Bounty Hunter")
- **Description** — Long-form narrative about character
- **Personality** — Key traits and characteristics
- **Scenarios** — A collection of named scenes, each with a title and content, describing the settings or situations the character may find themselves in. A character may have any number of scenarios, or none at all.

### Conversation Starter

- **First Message** — What the character says when you start chatting
- **Example Dialogues** — Show character speech patterns and style
- **System Prompt** — AI instructions on how to behave

### Media

- **Avatar** — Profile picture or icon
- **Physical Description** — Detailed appearance (optional)
- **Photos** — Multiple images associated with character (the **Photos** card on **Appearance**)

### Organization

- **Tags** — Categories for grouping characters
- **Favorite** — Mark as frequently used
- **NPC Status** — Mark as temporary vs. permanent

### Configuration

- **Default Connection Profile** — Which LLM to use for this character
- **Image Generation Profile** — For image creation in chats
- **Default Partner** — The character you play who sits opposite them in a new chat (see [Conversation Partners](character-management.md#conversation-partners))
- **Default Template** — Roleplay template to use

## Creating Characters

### Quick Create

1. Go to **Characters** page
2. Click **Create Character** or **+ New Character**
3. Fill in essential fields (name, description)
4. Click **Create**
5. Character created and ready to chat

**Minimal fields needed:**

- Name
- Description (can be short)

### Detailed Creation

For more control:

1. Click **Create Character**
2. Fill in the three cards:
   - **Facts** — name, title, aliases, pronouns, birthday, kind of character
   - **Dossier** — identity, description, manifesto, personality, first message, example dialogues
   - **How a chat begins** — a system prompt (saved as their first named prompt, "Default"), an opening scenario (saved as "Opening scene"), and a default connection profile
3. Click **Create Character**; their page opens, where the avatar, tags and everything else may be added

### Using AI Wizard

For characters with less writing:

1. Create character with name (description auto-generated)
2. Click **AI Wizard** button
3. Select which fields to auto-generate
4. Optionally upload reference image for appearance
5. Wizard generates content
6. Review and accept
7. Character created

See [Creating Characters](character-creation.md) for detailed guide.

## The Character's Page

Each character has one page, at `/aurora/<id>`, on which everything about them is both seen and changed. There is no separate edit screen and no **Save** button: every field saves itself (see [Editing Characters](character-editing.md#how-saving-works)). Across the top sits a header with the avatar, name, badges, a line of linked figures, **Start Chat**, the **Generate ▾** menu (AI Wizard, Refine from memories & instructions, Non-Quilltap prompt), the **⋯** menu (Export, Convert to NPC, Archive, Delete) and the favourite **⭐**. Beneath it are six sections:

### Details

- **Facts** — name, title, aliases, pronouns, birthday (and the age it gives), kind of character, tags
- **Dossier** — identity, description, manifesto, personality, first message and example dialogues, with `{{char}}` / `{{user}}` tokens and the names they could replace tinted in the editors, and the **Template tools** bar for swapping between them
- **Progressions** — timed spans the character carries
- **Vault** — where the character's files live in the Scriptorium, and whether any have gone missing

### Prompts

- **System prompts** — multiple named prompts; the **★** star marks the default
- **Subprompts** — smaller per-chat instructions
- **Scenarios** — named scenes, each opened in a dialog; the **★** star marks the default scenario, and an old scene may be archived rather than deleted

### Appearance

- **Photos** — the character's gallery: upload, browse, set as avatar, delete
- **Physical description** — the head-and-shoulders, short, medium, long and complete prompts and the full description, for AI context and image generation
- **Depiction guidelines** — the character's standing conditions on how they may be shown
- **Wardrobe** — opens the wardrobe, and holds the wardrobe instructions
- **Inventory** — opens the inventory, and lists what they carry by default

### Abilities

- System transparency, Aurora's Core whisper, answering @-queries (Carina), drawing diagrams, the wardrobe and inventory permissions, and whether you play the character yourself or they are an NPC

### Chat Defaults

What a new chat with the character begins with:

- Default connection profile (LLM provider)
- Default conversation partner
- Image generation profile
- Timestamp settings
- Agent mode default
- Help tools default

### History

- **Conversations** — every chat with the character; start a new one from here too
- **Memories** — the character's Commonplace Book:
  - Memories about this character
  - Memory details and dates
  - Search and filter
  - **Reinforcement count** — shows how many times a memory has been observed (e.g., "x3" badge means the same fact was seen in 3 separate exchanges). Frequently reinforced memories are considered stable knowledge and are better protected when maintenance trims a character to the cap
  - **Related memories** — memories that are thematically linked are connected together. When a new memory is similar but distinct from an existing one, both are linked for context
  - **Adding a memory by hand** — a memory you write yourself is filed as **MANUAL** and passes the same doorman as any other. Should the character already hold the very thing you have written *in your own hand* (another MANUAL memory) or in a consolidated digest, no duplicate is made: that memory is reinforced instead, takes whichever importance is the higher, yours or its own, and the confirmation says as much. Should the near-twin be something the character merely picked up in conversation, however, your words are never quietly swallowed by it — yours is filed as a memory of its own, linked to the extracted one so the two are found together. A hand-written memory is never archived or swept away by housekeeping
  - **Looking is not touching** — opening or reading a memory here does not count as the character recalling it, so a curious glance never props up a memory that would otherwise be eligible for the archive
  - **Editing a memory** — revise a memory's words and the Commonplace Book re-files it under what it now says, not what it said before: the character finds it, and the doorman weighs new arrivals against it, by the new text. Raise or lower its importance and its standing moves at once. A link you add to a related memory is fastened at both ends (and only to memories of the same character), and an edited consolidated digest is copied afresh into the character's `Commonplace/` notes. Should the embedding service be indisposed when you save new words, nothing is saved at all — the memory keeps its old text and you are told why, rather than left with new words filed under the old ones
- **Bulk edits** — Search & Replace, and Rename / Replace, each with a preview before anything changes
- **LLM logs** — folded away at the foot

## Editing Characters

### Editing Basics

1. Open the character
2. Go to the section that holds what you want to change
3. Change it — it saves itself when you pause or leave the field

See [Editing Characters](character-editing.md) for detailed guide.

### Template Replacement

Find and replace hard-coded names with placeholders:

- **{{char}}** — Character name
- **{{user}}** — Default partner name
- One click sweeps every prose field on the character — description, personality, first message, example dialogues, every scenario, every system prompt variant, and every physical-description entry (including the image-prompt slots). Structured metadata such as pronouns, aliases, and title is left untouched.
- Each button shows how many occurrences it will change; the work is saved at once

### Rename and Replace Tool

Replace text across:

- Character details
- All system prompts
- Physical descriptions
- All chat messages (optionally)
- Associated memories (content, summary, and keywords)

Useful for consistency and corrections.

## Character Relationships

### Default Partner

Characters can have a default conversation partner:

- Must be a user-controlled character (someone you control)
- Used in chat creation defaults
- Can be overridden per chat
- Affects template replacement

### Multi-Character Chats

Chat with multiple characters:

1. Create chat with main character
2. Add additional characters as conversation participants
3. Each character responds in turn (if LLM-controlled)
4. You control user-controlled characters

## Character Organization

### Tags

Organize characters with tags:

- Assign multiple tags to character
- Tag colors and styles customizable
- Filter characters by tag
- Quick-hide tags to collapse/hide

### Favorites

Mark frequently used characters:

- Click star to favorite
- Favorites appear first in list
- Quick visual identification

### Quick-Hide

Hide characters by tag:

- Enable quick-hide for tags
- Hidden characters collapsed in list
- Expand to see if needed
- Good for organizing large libraries

See [Character Organization](character-organization.md) for details.

## Deleting Characters

### Delete Confirmation

1. Open character
2. Click **Delete** button
3. Confirmation dialog shows:
   - What will be deleted
   - Associated chats
   - Associated images
   - Associated memories
4. Option to cascade delete or keep associated data
5. Click **Confirm Delete**

### What Gets Deleted

**Always deleted with character:**

- Character profile data
- All memories associated with character
- Physical descriptions

**Optional cascade deletion:**

- Exclusive chats (chats with only this character)
- Exclusive images (images only used by this character)

**Preserved:**

- Shared chats (with multiple characters)
- Shared images (used by other characters)
- Conversation history (if keeping chats)

See [Managing Characters](character-management.md) for more details.

## Character Import and Export

### Exporting Characters

Save character for sharing:

1. Go to character
2. Open the **⋯** menu in the header and choose **Export…**
3. Character downloads as JSON or PNG file
4. Can share with other users

**Export formats:**

- **JSON** — Character data in JSON format
- **PNG** — Image with embedded character data (SillyTavern compatible)

### Importing Characters

Load character created elsewhere:

1. Go to **Characters** page
2. Click **Import** button
3. Choose SillyTavern or JSON file
4. Character created with imported data
5. Optional: Modify before import

**Compatible formats:**

- SillyTavern PNG
- SillyTavern JSON
- Quilltap JSON export
- Compatible character formats

See [Importing and Exporting Characters](character-import-export.md) for guides.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Pages

- [Creating Characters](character-creation.md) — Step-by-step guide to creating new characters with templates and AI Wizard
- [Editing Characters](character-editing.md) — Modify character details, system prompts, and physical descriptions
- [Organizing Characters](character-organization.md) — Use tags, favorites, and filtering to manage your character collection
- [Character Management](character-management.md) — Delete characters, manage relationships, create partnerships, and handle NPCs
- [Character System Prompts](character-system-prompts.md) — Deep dive into prompt engineering and behavior configuration
- [Importing and Exporting Characters](character-import-export.md) — Backup, share, and import characters from other sources
- [Chats](chats.md) — Have conversations with your characters
- [Tags Customization](tags-customization.md) — Set up organization tags globally
- [Settings: Chat Settings](chat-settings.md) — Configure default character behavior
