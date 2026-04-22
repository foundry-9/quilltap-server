---
url: /aurora/:id/edit
---

# Editing Characters

> **[Open this page in Quilltap](/aurora)**

This guide covers how to modify and refine your existing characters in Quilltap.

## Accessing Character Editing

### Ways to Edit a Character

**From Characters List:**

1. Go to **Characters** page
2. Find character in list
3. Click character row or hover menu
4. Click **Edit** button or pencil icon

**From Character View:**

1. Click character to view details
2. Click **Edit** button at top
3. Directed to edit interface

**Quick Edit:** Some fields can be edited directly from the character list depending on your view settings.

## Character Edit Interface

The edit interface has multiple tabs for different aspects of character:

### Edit Tabs Overview

| Tab | Purpose | When to Use |
|-----|---------|-----------|
| **Details** | Name, description, personality, scenarios, first message | Modify core character info |
| **System Prompts** | AI instructions and behaviors | Fine-tune how character acts |
| **Appearance** | Physical descriptions and clothing records | Add visual and outfit information |
| **Rename/Replace** | Bulk rename or replace content | Reorganize or rebrand character |

## Editing Character Details

The Details tab contains all basic character information.

### Field-by-Field Editing

**Name**

- Click on name field
- Rename character
- Used everywhere system references character
- Examples: "Alice" → "Older Alice", "Detective Jones" → "Detective Sarah Jones"

**Title**

- Subtitle or role
- Optional field
- Examples: "The Wanderer", "Head Chef", "Royal Advisor"

**Description**

- Main character narrative
- Click to edit
- Can be lengthy
- Supports multiple paragraphs

**Personality**

- Character traits and characteristics
- Edit to refine how they're perceived
- Example: Add "Recently developed anxiety" to existing description

**Scenarios**

- A collection of named scenes, each with a title and descriptive content
- A character may accumulate any number of scenarios as their story progresses — one for the tavern, one for the road, one for that regrettable business in Marseille
- Add a new scenario when you begin a fresh campaign or a character finds themselves in significantly altered circumstances
- Edit existing scenarios to adjust their descriptive content; rename them as the situation demands
- Example additions: "The Road to Venice, 1924" when transitioning a tavern owner into a traveling merchant

**First Message**

- Opening greeting
- Update for variety or different campaign
- Keep consistent with character voice

**Example Dialogues**

- Sample conversations
- Edit to add more examples
- Remove ones that no longer fit
- Improve examples that weren't clear

### Making Bulk Changes

Want to change multiple characters at once? Use Rename/Replace tab (see below).

### Living Properties from the Scriptorium

Each character carries a private vault in the Scriptorium — a small database-backed document store seeded at creation with your character's identity, personality, wardrobe, and a small, tidy cluster of files that mirror the fields the Aurora editor knows by heart. When the overlay switch is thrown, Quilltap treats those files as the living authority for reads: the character you see in chats, on the roster, in image prompts, and in every other corner of the application comes straight from the vault.

**The overlaid files and what each one governs:**

| Vault file | What it replaces |
|---|---|
| `properties.json` | **pronouns**, **aliases**, **title**, **first message**, **talkativeness** |
| `description.md` | **Description** (the general prose field) |
| `personality.md` | **Personality** (the behavioral prose field) |
| `example-dialogues.md` | **Example Dialogues** (style samples for the LLM) |
| `physical-description.md` | The **Full Description** of the character's first (default) physical description |
| `physical-prompts.json` | The **short / medium / long / complete** prompts of the first (default) physical description (JSON with `short`, `medium`, `long`, `complete` keys) |
| `Prompts/*.md` | The character's **System Prompts** — one file per named variant, with YAML frontmatter carrying `name` (required) and an optional `isDefault: true` |
| `Scenarios/*.md` | The character's **Scenarios** — one file per scene, with the first `# heading` as the title and the body beneath as the context |
| `wardrobe.json` | The character's **Wardrobe Items** and **Outfit Presets** — one JSON file carrying `items`, `presets`, and an optional `outfit` placeholder |

By default, every one of these is read from the character's database row — the ordinary state of affairs, in which the editor is the single source of truth. Flip the switch marked **Read this character's core fields from the Scriptorium vault** at the top of the Aurora edit page, however, and henceforth Quilltap will consult the vault for all of the above every time any part of the application reads your character — the roster on the home page, the system prompt for a chat, the image-generation pipeline's appearance prompts, the scene state tracker, the turn manager's talkativeness roll, all of it.

**What the switch changes:**

- **Reads:** the overlaid fields come live from the vault files. Edit any file in the Scriptorium, save, reload the character, and the new values appear throughout the app without any further ceremony.
- **Writes:** still head to the database as always. Updates from other paths — imports, API calls, the optimizer — continue to land in the character row. The Aurora editor, however, disables the overlay-managed inputs while the switch is on, to spare you the indignity of silently overwriting database values with the vault values the form was showing you. The Descriptions tab grows a matching banner for the same reason.
- **Per-file fallback:** should a particular file go missing or fail to parse cleanly, Quilltap does not panic. Only that file's fields fall back to their database values (all-or-nothing within a file), and a warning is written to the log so you may investigate at your leisure. The other overlay files remain in effect.

**Sync from vault.** When the switch is on, a **Sync from vault** button appears beneath it. Pressing it copies the current vault values back into the character's database row — and, for the wardrobe, into the `wardrobe_items` and `outfit_presets` tables as well — the reconciliation step for when you have been editing the vault directly and would like the database to catch up. Fields whose vault files are missing or invalid are left alone; the rest are written. For the wardrobe, the vault's list is treated as authoritative: any items or presets no longer in `wardrobe.json` are removed from the database (including archived ones), and each item/preset is inserted with its id and timestamps preserved so references from outfit-preset slots survive the round-trip. You can then turn the switch off with no change in observed behavior, should you wish to resume database-canonical operation.

**A note on physical descriptions.** The `physical-description.md` and `physical-prompts.json` overlays target the **first** physical description (the one at index 0 — typically your character's default). Subsequent descriptions remain database-canonical. The overlay requires at least one physical description already present in the database; if your character has none, populate the first description the usual way in the Descriptions tab before filling in the vault files.

**A note on `Prompts/` and `Scenarios/`.** Each directory is read as a whole set — when the overlay is on and the folder holds at least one parseable file, the vault listing entirely replaces the character's database-backed array. An empty or malformed folder falls back to the database. Prompt files require YAML frontmatter naming them; a file that lacks frontmatter (or a `name` field) is quietly skipped while its siblings carry on. Scenario files want a `# Scenario Title` at the top, though if one is missing Quilltap will use the filename (without the `.md`) rather than drop the file entirely. Identifiers for synthesized prompts and scenarios are derived deterministically from the mount point and the file's relative path, so a chat's selected prompt or default scenario keeps its reference across reads as long as the filename doesn't change.

**A note on example dialogues.** An *empty* `example-dialogues.md` is a perfectly valid state — it means "no examples," and Quilltap treats it accordingly rather than falling back to the database. If you genuinely want the database value to show through, delete the file entirely; presence of the file (even at zero bytes) is what tells the overlay to take over.

**A note on the wardrobe.** `wardrobe.json` carries the character's full wardrobe — every item under `items[]` and every saved outfit preset under `presets[]`. When the overlay is on, the Salon sidebar, the wardrobe tools the LLM reaches for, and every other consumer read their lists from this file. The `outfit` block at the bottom is a placeholder — equipped-outfit state is tracked per chat rather than per character, and nothing in the app consults this field — but it's accepted on read so a hand-edited file keeps the scaffold's shape without failing validation. Items marked with a non-null `archivedAt` are filtered out of the normal list the same way they are in the database, and the `types` and `slots` fields are native JSON arrays and objects (no string-encoded JSON, unlike the database column storage). The first time Quilltap boots after the wardrobe overlay ships, a one-time sweep rewrites every existing character's `wardrobe.json` from the current database state — so stale snapshots from earlier vault provisioning don't mislead anyone the moment the switch is flipped on.

**When to use it.** Reach for this switch when you would rather author your character's prose fields as plain Markdown — version-controlled in your own tooling, perhaps, or edited alongside the character's narrative notes — and have the rest of Quilltap treat those files as the current truth. Leave the switch off for the conventional editor-as-source-of-truth workflow, which remains the default and entirely sensible choice.

**Prerequisite.** The switch requires a linked Scriptorium vault. Quilltap creates one for each character automatically (on character creation, or by the startup backfill), so this is almost always already in place; if for some reason it isn't, the toggle will disable itself with a note explaining why.

## Editing System Prompts

System Prompts tab contains detailed AI instructions.

### Understanding System Prompts

System prompts tell the AI exactly how to behave:

**Example:**

```
You are Captain Vex, a hardened pirate captain with a hidden code of honor. 
You speak with a pirate dialect, dropping g's (talkin', fightin'). You're 
strategic and cunning but never harm innocents. You're intensely loyal to 
your crew. Respond always in character as Captain Vex, maintaining this 
perspective and personality.
```

### Editing System Prompts

1. Click **System Prompts** tab
2. See current system prompt
3. Click **Edit** or inline edit the text
4. Modify prompt
5. Click **Save**

**Tips:**

- Start with existing prompt
- Enhance rather than replace
- Keep focused on key behaviors
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

If your character has different modes:

**Create prompt for each:**

- Character mode A: "When speaking to allies..."
- Character mode B: "When speaking to enemies..."
- Character mode C: "When alone..."

You can switch between prompts in chat settings.

### When to Edit System Prompts

- Character not behaving as expected
- Want different personality for new campaign
- Adding new dimensions to character
- Fixing specific problematic behaviors
- Improving response quality after testing

## Editing Physical Descriptions

The Appearance tab contains visual information about characters, including physical descriptions and clothing records.

### What Physical Descriptions Do

Physical descriptions help:

- AI understand character appearance
- Image generation tools create accurate images
- Consistency across conversations
- Detailed descriptions in roleplay

### Editing Physical Description

1. Click **Appearance** tab
2. See current descriptions (different lengths)
3. Edit manually or use AI to regenerate

### Physical Description Types

**Short Description** (1 sentence)

- Quick visual reference
- Good for status bars
- Example: "Tall woman with dark red hair and green eyes"

**Medium Description** (2-3 sentences)

- Balanced detail
- Good for quick lookups
- Example: "Tall woman with long dark red hair usually braided,
sharp green eyes, pale skin. Wears practical leather clothing."

**Long Description** (1 paragraph)

- Detailed information
- Good for image generation
- Example: "Tall woman (5'9") with waist-length dark red hair
usually worn in a complicated braid. Sharp green eyes, pale skin.
Thin face with high cheekbones. Usually wears practical leather
armor from her military days..."

**Complete Description** (2-3 paragraphs)

- Very detailed
- Good for AI generating multiple variations
- Includes mannerisms, clothing, accessories

**Full Description** (extensive)

- Maximum detail
- Best for detailed image generation
- Includes all visual elements, personality reflected in appearance

### Usage Context

Each physical description can have an optional **Usage Context** field — a short note (up to 200 characters) describing when this particular appearance is most appropriate.

**Examples of good values:**

- "at work in a professional capacity"
- "relaxing at the pool"
- "attending a formal gala"
- "in combat gear on a mission"

**How it affects AI behavior:**

- **In chat:** Physical descriptions are included in the system prompt sent to the AI. When multiple descriptions exist, the AI uses the usage context to decide which appearance best fits the current scene.
- **In image generation:** The usage context is passed to the image prompt crafting system, helping it select the most scene-appropriate visual details.

If no usage context is set, the AI will use the description based on its name and contents alone.

### Regenerating Descriptions

1. Click **Generate New Description**
2. Select which image source to use for generation:
   - From text (AI creates from character description)
   - From image file (upload image, AI analyzes)
   - From character image (use existing gallery image)
3. Wait for generation
4. Review generated descriptions
5. Accept all, edit some, or reject

### Uploading Images for Description

1. Click **Upload Image**
2. Select image file (JPG, PNG)
3. AI analyzes image
4. Generates descriptions based on appearance
5. Review and save

### Manual Physical Description

If you prefer to write manually:

1. Click **Edit** next to description
2. Type your description
3. Save

**Good example:**

```
Sarah is a tall woman with an athletic build, suggesting years of 
physical training. Her dark red hair is usually worn in a practical 
braid down her back. Sharp green eyes and high cheekbones give her 
a striking appearance. She has a small scar on her left eyebrow from 
an old injury. She dresses practically in leather jackets and dark 
jeans, with minimal jewelry except for a detective's badge on her belt.
```

## Editing Clothing Records

The Appearance tab also includes a **Clothing & Outfits** section below physical descriptions.

### What Clothing Records Do

Clothing records describe what your character wears in different situations. They are:

- Injected into the system prompt so the AI knows what the character is wearing
- Included in image generation context for accurate visual depiction
- Used by story background generation for scene-appropriate outfit selection

### Adding a Clothing Record

1. Click **Appearance** tab
2. Scroll to **Clothing & Outfits** section
3. Click **Add Outfit**
4. Fill in:
   - **Name** (required) — e.g. "Battle Armor", "Formal Gown", "Casual Wear"
   - **Usage Context** — When this outfit is worn, e.g. "in combat", "at formal events"
   - **Description** — Markdown text describing the outfit in detail
5. Click **Create**

### Managing Clothing Records

- **Edit:** Click the pencil icon on any clothing record card
- **Delete:** Click the trash icon to remove a record
- **Expand:** Click the chevron to see the full description rendered as markdown
- Multiple outfits can be defined per character for different contexts

## Using Rename/Replace Tab

The Rename/Replace tab helps with bulk changes to character content.

### Simple Rename

If you want to rename the character and update all references:

1. Click **Rename/Replace** tab
2. Enter **New Name**
3. Select **Replace in all content** option
4. Click **Rename**
5. Character renamed everywhere (description, prompts, etc.)

### Find and Replace

For bulk text replacement:

1. Click **Rename/Replace** tab
2. Enter **Find** text
3. Enter **Replace** text
4. Click **Preview** to see what will change
5. Click **Replace All** to confirm
6. All matching text updated

**Examples:**

- Find: "pirate ship" → Replace: "airship" (changing genre)
- Find: "he" → Replace: "she" (changing gender)
- Find: "London" → Replace: "New York" (changing setting)

### Preview Changes

Always use Preview before Replace All:

1. Enter find/replace terms
2. Click **Preview**
3. See highlighted changes
4. Review carefully
5. Click **Replace All** if correct

## Keyboard Shortcuts for Editing

| Action | Shortcut |
|--------|----------|
| Save | Cmd+S or Ctrl+S |
| Undo | Cmd+Z or Ctrl+Z |
| Redo | Cmd+Shift+Z or Ctrl+Y |
| Close edit | Esc or Click close |

## Editing Workflow: Common Scenarios

### Scenario 1: Character Acting Wrong in Chats

**Problem:** Character not behaving as expected

**Solution:**

1. Identify specific behavior issue
2. Edit System Prompts tab
3. Add specific instruction:

   ```
   "Do NOT break character to explain yourself. Stay as [Character] always."
   ```

4. Save and test in new chat

### Scenario 2: Updating Character for New Campaign

**Problem:** Same character, different time period/setting

**Solution:**

1. Edit **Details** tab:
   - Add a new scenario with a title reflecting the new setting — rather than erasing the old one, let the character carry their history with them
   - Update Description if time has passed or circumstances have changed substantially
2. Edit **System Prompts** tab:
   - Add context about new time period
   - Update relevant personality notes
3. Optional: Update Physical Description if appearance changed
4. Save and test

**Note:** The character's previous scenarios remain intact, available for flashbacks, parallel campaigns, or the sort of elaborate timeline shenanigans that make worldbuilders so very pleased with themselves.

### Scenario 3: Adding Relationship Information

**Problem:** Want to note character relationships

**Solution:**

1. Edit **Details** tab
2. Add to Personality or Description:

   ```
   "Close relationship with [Other Character Name]. Has tension with [Another Character]."
   ```

3. Save

### Scenario 4: Fixing Accent/Speech Pattern

**Problem:** Character not using intended speech pattern

**Solution:**

1. Edit **System Prompts** tab
2. Add communication instruction:

   ```
   "You speak with a Southern accent. Drop g's from -ing words (talkin', 
   fightin', walkin'). Use y'all and regional expressions naturally."
   ```

3. Add examples to Details > Example Dialogues showing accent in action
4. Save and test

### Scenario 5: Making Character Darker/Lighter

**Problem:** Character tone isn't matching what you want

**Solution:**

1. Edit **Details** tab:
   - Adjust Personality to shift tone
   - Update First Message if needed
   - Add Example Dialogues showing new tone
2. Edit **System Prompts** tab:
   - Add specific tone instruction:

     ```
     "Your responses have a dark, cynical tone tinged with dark humor."
     ```

3. Save and test

## Advanced Editing Techniques

### Layered System Prompts

Create prompts that work in layers:

```
Core instruction: You are [Character]. You [core trait].

When speaking to allies: [behavior A]
When speaking to strangers: [behavior B]
When alone: [behavior C]

Always maintain: [core personality]
```

### Conflicting Traits

If character has contradictions, explain them:

```
You are [Character], someone with seemingly contradictory traits:
- Appears tough but is deeply empathetic
- Speaks harshly but acts with kindness
- Seems confident but battles internal doubt

This contradiction is core to your character. Express both sides naturally.
```

### Prompt Testing

After editing system prompts:

1. Start new chat with character
2. Try different conversation angles
3. See if behavior matches intent
4. Return to edit if needed
5. Iterate until satisfied

## Best Practices for Editing

### Do's ✓

- Keep edits consistent across tabs
- Test changes in chats before finalizing
- Maintain backup of old version if changing significantly
- Use Physical Descriptions for visual reference
- Keep System Prompts focused and clear
- Update all character variants together

### Don'ts ✗

- Don't overwrite character details without review
- Don't create contradictory instructions in System Prompt
- Don't remove important personality traits accidentally
- Don't change core character concept without confirmation
- Don't ignore preview warnings before Replace All

## Undoing Changes

### If You Make a Mistake

1. Immediately click **Undo** (Cmd+Z)
2. This undoes recent edits
3. Or close without saving to discard changes
4. Character reverts to last saved state

### Recovering Old Version

If you saved unwanted changes:

1. There's no version history feature
2. Make note of changes you want to undo
3. Edit manually back to previous state
4. Or use Find/Replace to reverse changes

**Tip:** If making major changes, copy character details to Notes app as backup before editing.

## Performance Tips

### For Complex Characters

If your character has extensive details:

- Keep System Prompt under 500 words
- Break very long descriptions into multiple sections
- Use shorter first message (1-2 sentences)
- Keep example dialogues focused

### Character with Multiple Aspects

If character has different modes:

- Create separate System Prompt for each mode
- Add notes about when to use each
- Test each variant thoroughly
- Keep consistent core personality

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora/:id/edit")`

## Related Topics

- [Character Creation](character-creation.md) — Creating new characters
- [Character System Prompts](character-system-prompts.md) — Deep dive on prompts
- [Organizing Characters](character-organization.md) — Tags and management
- [Chats](chats.md) — Testing character in conversations
- [Characters Overview](characters.md) — About characters
