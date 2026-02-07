# Characters Overview

> **[Open this page in Quilltap](/characters)**

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
3. Click character to view or edit
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
- **Action Buttons** — Edit, view, delete, start chat

### Sorting and Organization

Characters are sorted by:

1. **Favorites first** — Starred characters appear at top
2. **Chat frequency** — Most chatted-with characters first
3. **NPCs last** — Regular characters before temporary NPCs
4. **Then alphabetically** — By character name

### Quick Actions

**From character card:**

- **View** — See character details
- **Edit** — Modify character information
- **Chat** — Start new conversation
- **Favorite/Unfavorite** — Toggle star
- **Toggle Control Mode** — Switch LLM/User-controlled
- **Delete** — Remove character

## Understanding Character Attributes

### Identity

- **Name** — What the character is called
- **Aliases** — Optional alternate names the character goes by (e.g., "Liz", "Lizzy" for "Elizabeth")
- **Pronouns** — Optional pronouns for the character (e.g., he/him/his, she/her/her, they/them/their). Choose from presets or enter custom pronouns. When set, pronouns are included in system prompts so the LLM uses them correctly, and displayed on the character's view page.
- **Title** — Optional subtitle or role (e.g., "Bounty Hunter")
- **Description** — Long-form narrative about character
- **Personality** — Key traits and characteristics
- **Scenario** — The setting or situation character exists in

### Conversation Starter

- **First Message** — What the character says when you start chatting
- **Example Dialogues** — Show character speech patterns and style
- **System Prompt** — AI instructions on how to behave

### Media

- **Avatar** — Profile picture or icon
- **Physical Description** — Detailed appearance (optional)
- **Photo Gallery** — Multiple images associated with character

### Organization

- **Tags** — Categories for grouping characters
- **Favorite** — Mark as frequently used
- **NPC Status** — Mark as temporary vs. permanent

### Configuration

- **Default Connection Profile** — Which LLM to use for this character
- **Image Generation Profile** — For image creation in chats
- **Default Partner** — Character to chat with (for partnerships)
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
2. Fill all available fields:
   - Name, title, description
   - Personality traits
   - Background/scenario
   - First message
   - Example dialogues
   - System prompt
   - Avatar
   - Tags
3. Select default connection profile
4. Click **Create**

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

## Viewing Characters

### Character Details Tab

View comprehensive character information:

- Full description with formatting
- Personality and background
- Example dialogues
- Physical description
- Current configuration
- Tags and organization

View shows template placeholders (like `{{character}}`) highlighted, helping you see how the character's information will be used.

### System Prompts Tab

See and edit all system prompts:

- Multiple named prompts
- Default prompt indicator
- Full text preview
- Edit/delete options

### Conversations Tab

Browse chat history:

- List of all chats with character
- Search within conversations
- Message previews
- Start new chat from history

### Memories Tab

View associated memories:

- Memories about this character
- Memory details and dates
- Search and filter

### Tags Tab

Manage character organization:

- Current tags
- Add/remove tags
- Quick-hide settings
- Filter by tag

### Associated Profiles Tab

Configure character partnerships and defaults:

- Default conversation partner
- Connection profile (LLM)
- Image generation profile
- Roleplay template

### Photo Gallery Tab

Browse character images:

- All associated images
- Avatars and profile pictures
- Physical description images
- Upload new images
- Set as default avatar

### Physical Descriptions Tab

View detailed appearance:

- Various description lengths (short/medium/long/complete/full)
- Useful for AI context and image generation
- View or regenerate descriptions

## Editing Characters

### Editing Basics

1. Open character
2. Click **Edit** button
3. Modify fields as needed
4. Click **Save**

Editable fields:

- Name, aliases, pronouns, title, description
- Personality and scenario
- First message and examples
- Avatar and images
- Tags
- System prompts
- Default profiles
- Physical description

See [Editing Characters](character-editing.md) for detailed guide.

### Template Replacement

Find and replace hard-coded names with placeholders:

- **{{character}}** — Character name
- **{{user}}** — Default partner name
- Bulk replace across all fields
- Preview changes before applying

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
2. Click **Export** button
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
