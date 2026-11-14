---
url: /aurora/new
---

# Creating Characters

> **[Open this page in Quilltap](/aurora)**

This guide walks you through creating new characters in Quilltap, from simple characters to fully detailed personas.

## Getting Started with Character Creation

### Accessing Character Creation

1. Open **Aurora** (`/aurora`) from the left sidebar
2. Click **Create Character** or **+ New Character**
3. The New Character form appears
4. Fill in whatever you like — only the name is required
5. Click **Create Character**

The New Character form is the one place in Aurora with a **Create** button, because until you press it there is no character to save things against. The moment it is pressed, the new character's page opens, and from there on every field saves itself (see [Editing Characters](character-editing.md)).

**Quick tip:** You can create a character with nothing but a name, and furnish the rest at leisure.

## The New Character Form

The form is three cards, laid out in the same shape as the character's own page.

### Facts

**Name** (required)

- What the character is called, used throughout the system
- Leave it empty and the form declines to create anyone, with a note saying why
- Examples: "Alice", "Lord Blackthorne", "Captain Nova"

**Title** (optional)

- Your private label for the character — the protagonist, the rival, the love interest. Not how strangers refer to them

**Aliases** (optional)

- Other names the character answers to, added one at a time as chips

**Pronouns** (optional)

- Choose a preset or **Custom**. When set, they are included in system prompts so the LLM uses them correctly
- The third pronoun is the one that comes before a noun ("her lamp", "their lamp"), not the one that stands alone ("hers", "theirs"). Should the AI Wizard or Summon From Lore hand back "hers" or "theirs" for a plain she/her or they/them character, Quilltap quietly corrects it to the preset rather than filing the character under Custom

**Birthday** (optional)

- A real date of birth; set one and the character's age is reckoned for you, a year older on each birthday

**Kind of character**

- **Roleplay character** (the default) or **Assistant**. See [Editing Characters](character-editing.md) for what the difference means

### Dossier

**Identity**

- The outside view — what a stranger could know on sight or by reputation
- Written about the character: *"Ariadne is a research librarian at the Athenaeum."*

**Description**

- How acquaintances perceive the character — behaviour, mannerisms, verbal habits; not physical appearance
- Examples:
  - "A clever detective from Victorian London"
  - "An ancient dragon with a love of riddles"
  - "A cheerful barista who writes poetry in free time"
- Only *other* characters ever read this field, so write it about the character from outside. Written as: *She finishes other people's sentences, then apologises for it.*

**Manifesto**

- The axiomatic core — the load-bearing truths every other field stays consistent with
- Addressed to the character: *"You do not lie to Charlie, not even kindly."*

**Personality**

- Key personality traits and characteristics, as the character knows them
- How they typically behave; their temperament and attitude
- Examples: "Sarcastic but kind", "Serious and professional", "Playful and mischievous"
- Only the character themselves reads this field, so address them directly. Written as: *You keep your worry behind your teeth. You have never once asked for help first.*

**First Message**

- What the character says when you start chatting
- Sets tone for conversation
- Examples:
  - "Well, well... another visitor. What brings you to my domain?"
  - "Oh, hey! Haven't seen you in forever. What's up?"
  - "Greetings, traveler. You look like you have a story to tell."

**Example Dialogues**

- Sample conversations showing character speech
- Helps AI understand conversation style
- Format: Multiple exchanges showing typical dialogue
- Shows personality and vocabulary through examples

Each empty field shows its hint and a "Written as:" example, so you need never wonder what belongs where.

### How a Chat Begins

**System Prompt** (optional)

- Instructions for the AI on how to behave as the character
- Write as though speaking to the character. Written as: *You are Ariadne. You answer plainly and you never flatter.*
- **Import Template** fills it from one of your saved prompt templates
- Saved as the character's first named system prompt, called **Default**. More may be added, and the default changed, in the **Prompts** section of their page

**Scenario** (optional)

- The scene a chat with the character opens on — scene text addressed to no one. Written as: *The reading room is empty at this hour, rain against the high windows.*
- Saved as the character's first scenario, titled **Opening scene**. Rename it, or add as many others as the story requires, in the **Prompts** section of their page
- A character may have any number of scenarios — or none at all, if they prefer to remain contextually mysterious. When starting a new chat, you may choose which applies

**Default connection profile** (optional)

- Which LLM speaks for this character
- Can be overridden for individual chats
- If not selected, the system default is used

### After Creation

Everything else lives on the character's page, which opens the moment they are created:

- **Avatar** — click the avatar in the header to choose from photos, upload, or generate a portrait
- **Tags** — in the **Facts** card on **Details**
- **Physical description**, **photos**, **wardrobe** — on **Appearance**
- **Image generation profile** and the other chat defaults — on **Chat Defaults**

## Creating Characters: Step-by-Step

### Method 1: Quick Create (Fastest)

If you want to create a character and start chatting right away:

1. Open **Aurora**
2. Click **Create Character**
3. Enter:
   - **Name:** "Alice"
   - **Description:** "A curious young woman who asks lots of questions"
4. Click **Create Character**
5. Their page opens — press **Start Chat**

**Time:** < 1 minute
**Best for:** Quick roleplay, testing ideas, temporary characters

### Method 2: Detailed Create (Recommended)

For a well-developed character:

1. Click **Create Character**
2. **Facts:**
   - Name: "Captain Vex"
   - Title: "the rogue"
   - Pronouns, aliases and birthday as you see fit
3. **Dossier:**
   - Description: "Veteran space pirate with a hidden heart of gold..."
   - Personality: "You are bold and cunning, and secretly honourable"
   - First Message: "Well, what brings you aboard me ship?"
   - Example Dialogues:

     ```
     {{user}}: "Why become a pirate?"
     {{char}}: "Because the galaxy doesn't belong to the wealthy. It belongs to those bold enough to take it."
     ```

4. **How a chat begins:**
   - System Prompt: "You are Captain Vex…"
   - Scenario: "Aboard the *Rattlesnake*, a fast merchant vessel with a crew of six and secrets in the hold"
   - Select a connection profile (if you have several)
5. Click **Create Character**
6. On the page that opens, add tags, set the avatar, and fill in the physical description

**Time:** 5-15 minutes
**Best for:** Characters you'll chat with regularly

### Method 3: Using AI Wizard (Easiest Writing)

If you want AI to generate content:

1. Click **Create Character**
2. Optionally enter **Name** (or let wizard generate)
3. Enter short **Description** (or let wizard generate)
4. Click the **AI Wizard** button at the top of the form
5. **Step 1: Select LLM Profile**
   - Choose which AI to use for generation
   - Click **Next**
6. **Step 2: Physical Description Source**
   - Choose one:
     - Use existing character data (AI creates from description/personality)
     - Upload a new image (AI analyzes image)
     - Select from gallery (use existing image)
     - Upload a document (text, Markdown, or PDF with character details)
     - Skip (no description)
7. **Step 3: Select Fields to Generate**
   - Check which fields AI should create:
     - ☐ Name (if not provided)
     - ☐ Title
     - ☐ Properties (pronouns and aliases — only what the source material supports; no invented placeholders)
     - ☐ Identity (outside view — what strangers know on sight; written about the character: *"Ariadne is a research librarian at the Athenaeum."*)
     - ☐ Description (acquaintance view — behaviour and mannerisms, not appearance; written about the character: *"She finishes other people's sentences, then apologises for it."*)
     - ☐ Manifesto (axiomatic core — load-bearing truths and basic tenets; addressed to the character: *"You do not lie to Charlie, not even kindly."*)
     - ☐ Personality (internal view — self-knowledge and inner drivers; addressed to the character: *"You keep your worry behind your teeth."*)
     - ☐ Scenarios
     - ☐ Example Dialogues
     - ☐ First Message (the character's opening message for new chats)
     - ☐ System Prompt (addressed to the character: *"You are Ariadne. You answer plainly and you never flatter."*)
     - ☐ Physical Description (appearance only — nothing removable; bare descriptive phrases, since this text also drives image generation: *"auburn hair cut short; grey eyes; a scar across the left knuckle"*)
     - ☐ Wardrobe (slot-typed items with image cues, plus composite outfits; the everyday outfit is marked default)
   - Leave others blank for manual entry
   - The wizard treats Identity, Description, Manifesto, Personality, and Physical Description as distinct vantage points — the same trait won't be repeated across them — and keeps everything removable in the Wardrobe rather than the Physical Description.
8. **Step 4: Review and Generate**
   - AI generates selected content
   - Review generated text
   - Accept or edit
   - A field marked with a red cross was not written. The wizard would sooner confess a blank than hand you half an identity trailing off mid-sentence, so a reply the model could not finish is reported as a failure rather than saved. Run the wizard again for just that field; the newer reasoning models are now given room to think *and* to answer, so this is a rare sight.
9. Click **Create Character**
10. Character created with generated content — a generated system prompt is saved as their **Default** prompt

**Time:** 2-5 minutes
**Best for:** When you have a concept but need help fleshing it out, or want a completely random character

## Character Fields: Detailed Guide

A word before the particulars: every field is delivered to *somebody*, and the courteous thing is to address that somebody. Fields only the character themselves ever reads (Manifesto, Personality, System Prompts) are written **to** the character — *"You do not lie to Charlie, not even kindly."* Fields only other characters read (Identity, Description) are written **about** the character from outside — *"Ariadne is a research librarian at the Athenaeum."* Physical descriptions are bare phrases for the image pipeline; scenarios are scene text addressed to no one. The full etiquette lives in [Editing Characters](character-editing.md), and the editor shows a "Written as:" example beneath each field.

### Writing Effective Descriptions

**Good character description:**

```
Keira is a 35-year-old detective with 10 years on the force. 
Tough exterior, but deeply empathetic to victims. Driven by 
a need for justice, especially in cold cases. Divorced, no kids, 
workaholic. Has a dry sense of humor to cope with the darkness 
she sees daily. Haunted by one case she couldn't solve.
```

**Poor character description:**

```
A detective
```

**Tips:**

- Be specific about who they are
- Include notable characteristics
- Mention background/history
- Show what drives them
- At least 2-3 sentences

### Writing Effective Personality Traits

**List specific traits:**

```
Personality: Intelligent but insecure about it, uses humor as defense, 
loyal to a fault, perfectionist, anxious in social situations, 
passionate about learning, struggles with authority
```

**Avoid generic traits:**

```
Personality: Nice, smart, funny
```

**Better approach:**

- List 4-7 specific traits
- Include both strengths and flaws
- Show how they interact with others
- Mention internal conflicts

### Writing Effective First Messages

**Good first message:**

```
"Well, well... another visitor finds their way to my study. 
Most people find the old books boring, but I suspect you're 
not most people. Tea?"
```

**Poor first message:**

```
"Hi"
```

**Tips:**

- Show personality in the greeting
- Set tone for conversation
- Ask engaging question
- Make character voice clear
- 1-2 sentences usually best

### Writing Example Dialogues

**Format:**

```
You: [What someone might say to character]
Character: [What character would respond]

You: [Another example exchange]
Character: [Character response showing different aspect]
```

**Good example:**

```
You: "Why did you become a pirate?"
Captain Vex: "Aye, 'tis a fair question. The ocean called to me, 
and I wasn't one to ignore such a voice. Besides, the world's riches 
shouldn't belong to those born with silver spoons, should they?"

You: "That sounds dangerous."
Captain Vex: "Dangerous? Of course it is. The best things usually are. 
But I'll not lie to ye - there's nothing quite like the freedom of 
the open sea, the wind at your back, and no one to answer to but yourself."
```

**Poor example:**

```
Me: "Hi"
Character: "Hi"
```

**Tips:**

- Show 2-3 different conversation angles
- Let character voice shine through
- Show how they handle different topics
- Include personality quirks in responses
- Should be natural and realistic

### System Prompt Guidelines

System prompts give the AI detailed instructions on behavior. Well-written system prompts = better character roleplay.

**Good system prompt:**

```
You are Captain Vex, a hardened space pirate with a hidden sense of honor. 
Maintain a pirate dialect/accent (drop some g's, use nautical terms).
You're clever and strategic - you think before acting. You show loyalty to 
your crew above all else. You're cynical about authority but surprisingly 
compassionate to the underdog. Respond in character always, maintaining 
Captain Vex's voice and perspective.
```

**Poor system prompt:**

```
Be a pirate
```

**Best practices:**

- Describe the character clearly
- Explain key personality traits
- Mention communication style
- Set boundaries on behavior
- Give context for decision-making
- Keep to 3-5 paragraphs

**What the AI Wizard writes in for you.** A system prompt generated by the AI Wizard now carries the same safeguards as the [sample prompts](prompts.md): what you narrate is what happened, the conversation (not the character's notes) settles who said what, no setting facts are invented to win an argument, an arrangement binds you only if you agreed in plain words, and disagreement stays a disagreement rather than a committee of votes and sign-offs. These are written in the character's own voice — a ship's AI might say its sensors were wrong if they disagree with the captain's account — rather than pasted in as a rule list, and they hold for a rival as firmly as for a friend. A *disposition of trust* (backing you first in a crisis, asking afterward) is added only when the material establishes the character as your companion, partner, family, or crew; a neutral or adversarial character goes without. It also follows the character's **kind** (set in the **Facts** card on their **Details** section): a roleplay character's prompt says how they react when the story turns — matching the stakes, with their usual temper as a starting point rather than a vow, so that no prompt ever decrees "never tense" or "always calm" — while an assistant's prompt says how they do the work: accurately, owning up to what they do not know, and without padding. A brand-new character is written as a roleplay character; the Wizard never guesses the kind from your material, since a butler who serves your household is still a person in your story. Run from the New Character form, the Wizard's system prompt fills the System Prompt field and is saved as **Default**; run later from a character's page (**Generate ▾ → AI Wizard…**), it is saved as a new named prompt — **Default** if the character had none, otherwise **AI Wizard** — leaving your existing prompts and their star exactly as they were.

## Quick Character Templates

Use these as starting points for common character types:

### Template: Detective

```
Name: [Detective Name]
Title: Detective / Private Investigator
Description: Seasoned detective with [X years] experience.
Personality traits include [traits]. Driven by [motivation].
Personality: [Specific traits - suspicious, analytical, intuitive, etc.]
Scenarios:
  - "[City/Setting], [Year]": Working cases in the city, office hours
  - "The Crime Scene": Called to an active investigation
First Message: "Another case lands on my desk. You look like
you've got something to tell me..."
```

### Template: Fantasy Character

```
Name: [Character Name]
Title: [Race/Class, e.g., "Elf Ranger"]
Description: [Character backstory in fantasy world]
Personality: [Personality in context of fantasy setting]
Scenarios:
  - "[Location of Current Quest]": [Quest/situation they're in]
  - "[Home Village or Base Camp]": At rest, between adventures
First Message: "[Greeting in character, hinting at current situation]"
Tags: Fantasy, [Faction/Group], [Role]
```

### Template: Modern Day

```
Name: [Character Name]
Title: [Job/Role, e.g., "Coffee Shop Owner"]
Description: [Who they are in modern setting]
Personality: [Contemporary personality traits]
Scenarios:
  - "[Workplace Name]": At work during regular hours
  - "After Hours": [Current life situation outside of work]
First Message: "[Natural modern greeting with personality]"
Tags: Modern, [Workplace/Circle], [Type]
```

### Template: Sci-Fi

```
Name: [Character Name]
Title: [Sci-Fi Role, e.g., "AI Assistant"]
Description: [Sci-Fi background and context]
Personality: [How they interact, AI quirks, etc.]
Scenarios:
  - "Aboard the [Ship/Station Name]": [Default shipboard situation]
  - "[Planet or Location]": [Planetside or mission scenario]
First Message: "[Sci-Fi greeting showing character]"
Tags: SciFi, [Setting/Faction], [Role]
```

## After Creating a Character

### What You Can Do Next

1. **Start Chatting**
   - Click **Start Chat** on their page to begin a conversation
   - Character will greet you with first message
   - Enjoy talking with your new character

2. **Refine Details**
   - Create more detailed system prompt
   - Add physical description
   - Upload better avatar
   - Add more example dialogues

3. **Set Up Relationships**
   - Assign default partner (for multi-character conversations)
   - Choose default connection profile
   - Configure image generation

4. **Organize**
   - Add tags for organization
   - Mark as favorite if frequently used
   - Set up quick-hide if needed

5. **Share**
   - Export character for sharing
   - Share with other Quilltap users
   - Import characters created by others

## Common Creation Mistakes

### Mistake 1: Too Generic

**Problem:**

```
Name: Hero
Description: A person who goes on adventures
```

**Solution:**

```
Name: Kael Stormborn
Description: A ranger from the northern highlands, haunted by a 
tragedy that took her family. Seeks redemption through protecting others.
```

### Mistake 2: Conflicting Personality

**Problem:** First message says character is shy, but personality is outgoing, and their scenario casts them as a bold pirate.

**Solution:** Ensure description, personality, scenarios, and first message all align with a consistent character.

### Mistake 3: System Prompt Too Long

**Problem:** 10+ paragraph system prompt that repeats itself

**Solution:** Keep to 3-5 focused paragraphs with most important information first.

### Mistake 4: No System Prompt at All

**Problem:** Character behaves inconsistently or not as intended

**Solution:** Even a brief system prompt helps AI understand character:

```
You are [Name], [basic description]. You speak [communication style]. 
Your priorities are [key motivations].
```

### Mistake 5: Not Testing

**Problem:** Create character but never chat with them

**Solution:** Start a chat right after creation to test how character behaves. Make adjustments based on what you see.

## Advanced: Physical Descriptions

### Why Physical Descriptions Matter

Physical descriptions help:

- AI understand how character looks
- Image generation create accurate images
- Consistency across conversations
- Contextual descriptions in messages

### Adding Physical Description

1. **During creation:** Use AI Wizard
   - Upload reference image
   - AI generates description
   - Accept or edit

2. **After creation:** the **Physical description** card on the character's **Appearance** section
   - Write or revise each length by hand — every field saves itself
   - Or let **Generate ▾ → AI Wizard…** or **Refine from memories & instructions…** in the header propose new ones

### Physical Description Formats

Generated descriptions include multiple length options:

- **Short** (1 sentence) — Quick reference
- **Medium** (2-3 sentences) — Balanced detail
- **Long** (paragraph) — Detailed description
- **Complete** (2-3 paragraphs) — Very detailed
- **Full** (extensive) — Maximum detail for images

## Advanced: Clothing and Outfits

What a character wears is kept in their [Wardrobe](wardrobe.md), not in a separate list of clothing records. After creation, open the **Wardrobe** card on the character's **Appearance** section and click **Open wardrobe** to add garments and composite outfits; the AI Wizard can also draft a wardrobe for you during creation. Whatever the character has on is told to the LLM and to the image generators, so the scene and the pictures agree.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora/new")`

## Related Topics

- [Characters](characters.md) — Characters overview
- [Editing Characters](character-editing.md) — Modifying characters
- [AI Wizard](ai-character-import.md) — Using AI to generate content
- [System Prompts](character-system-prompts.md) — Advanced prompt configuration
- [Character Organization](character-organization.md) — Tags and management
- [Chats](chats.md) — Starting conversations with characters
