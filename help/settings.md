---
url: /settings
---

# Settings (The Foundry)

> **[Open this page in Quilltap](/settings)**

The Settings page --- whose door bears the grander name **The Foundry** --- is the central bureau of operations for your Quilltap estate: a single, well-appointed room where every lever, dial, and velvet rope can be found by reasoning about *what it does*, rather than by remembering which member of staff happened to be standing nearest when it was installed. The settings are filed in ten plainly-labelled groups down the left-hand side; the staff who look after each one wear their likenesses on the cards themselves.

## Accessing Settings

1. Click the **Settings** icon (wrench) in the left sidebar footer
2. You will arrive in **Connections** --- unless something in the house needs your attention, in which case you arrive wherever it is (see *The Attention Strip*, below)
3. Choose a group from the rail on the left (on a narrow screen, from the **Section** menu at the top) and open whichever card you require

### Addresses worth knowing

| Address | Where it takes you |
|---|---|
| `/settings?group=security` | A group |
| `/settings?section=uncensored-desk` | A card --- its group opens, the card opens, and the page scrolls to it |
| `/settings?persona=pascal` | One member of staff's settings, wherever they live |
| `/settings?q=password` | The page, already searched |

## Finding a Setting

### The search field

At the top of the page sits a search field (press **/** from anywhere on the page to put your cursor in it, and **Escape** to clear it). Type, and the page narrows as you go: the rail keeps only the groups with something to offer, each with a count of its matches; the cards that match open themselves; and the words you typed are marked in their titles. Plain speech is welcome --- "password", "dice", "censor", "backup" --- and so is the name of a member of staff: search for "Pascal" and you will see precisely the cards the Croupier minds. Clear the search and the page returns to exactly the group and the open cards you left.

### The staff, and their lenses

Above the rail stands a row of the household staff --- the Forge, Saquel, the Salon, the Commonplace Book, Aurora, the Lantern, Pascal, Prospero, Brahma, the Concierge and Calliope. Choose one and the whole page is seen through their eyes: every card they are responsible for, in whichever group it lives, and nothing else, against their own backdrop. A banner names whom you are looking through; **Show everything** (or choosing the same chip again) puts the page back as it was. The lens and the search work together, should you wish to search only Prospero's affairs.

Every card, lens or no lens, wears a small badge with the likeness of the member of staff responsible for it; hover over the badge to be told who they are.

### Advanced cards

Some groups keep their rarer, weightier instruments below a rule marked **Advanced** --- the regeneration of every memory, the deletion of everything, the Concierge's optional doorman. They work exactly as the others do; they are merely kept further from the elbow.

## The Attention Strip

When something in the house wants seeing to, a row of chips appears above the staff:

- a connection, image or embedding profile whose key has gone missing or whose provider plugin is absent;
- the Concierge off duty;
- memories waiting for their embeddings;
- a background task that has failed;
- a plugin that failed to load.

Each chip says what is the matter and, when clicked, opens the card that will put it right. When nothing is amiss the strip simply isn't there. Arrive at a plain `/settings` while a chip is lit and you are taken straight to the first one's group.

## The Ten Groups

### Connections

Where Quilltap is introduced to the model-making concerns of the world.

- **AI Stack Setup Wizard** --- A guided walk through providers, keys, models and profiles in one efficient swoop
- **Providers** --- Every provider you use, each with its keys and every profile --- connection, image or embedding --- that relies on it. Switch to **By kind** for the four familiar lists: API Keys, Connection Profiles, Image Profiles, Embedding Profiles
- **Cheap LLM Settings** --- The lightweight model that handles background tasks (summaries, titles, memory extraction and the like)

> See [API Keys Settings](api-keys-settings.md), [Connection Profiles](connection-profiles.md), [Image Generation Profiles](image-generation-profiles.md), [Embedding Provider Profiles](embedding-profiles.md) and [Setup Wizard](setup-wizard.md)

### Composer & Display

How you write in the Salon, and how the conversation is laid before you.

- **Composition Mode**, **Composer** (spellcheck, emoji, unicode, impersonation voice), **Slash Commands**, **Text Replacement**, **Smart Typography**, **Auto-Scroll**, **Token Display**, **Thinking / Reasoning**

> See [Chat Settings](chat-settings.md) and [Composer Settings](chat-settings-composer.md)

### Context & Memory

What the characters remember, and how much of the past they are handed each turn.

- **Context Compression**, **Memory Cascade**, **Data Retention**, **Extraction Grain**, **Recall Relevance**, **Maintenance**
- Advanced: **Repair Missing Embeddings**, **Regenerate Memories**, **Regenerate Conversation Summaries**

> See [Memory Maintenance](memory-maintenance.md), [Recall Relevance](memory-recall-relevance.md) and [Data Retention](data-retention.md)

### Characters & Prompts

The scriptwriting department, and the list of words no one in the house may say.

- **Roleplay Templates**, **Prompts**, **Aurora's Core Whisper**, **Taboo**

> See [Roleplay Templates](roleplay-templates.md), [Prompts](prompts.md), [Core Whisper](core-whisper.md) and [Taboo](taboo.md)

### Images

The gallery and the lighting both.

- **Story Backgrounds**, **Wardrobe Images**, **Default Aesthetics**, **Image Description**

> See [Story Backgrounds](story-backgrounds.md), [Wardrobe Images](wardrobe-images.md) and [Image Aesthetics](image-aesthetics.md)

### Games & Tools

Pascal's tables, Prospero's instruments, Brahma's console, and the rooms that carry on without you.

- **Automation** (dice and detection), **Custom Tools**, **Agent Mode**, **Answer Confirmation**, **Brahma Console**, **Autonomous Rooms**, **Scheduled Autonomous Rooms**
- Advanced: **General State**

> See [Custom Tools](custom-tools.md), [Agent Mode](agent-mode.md), [Brahma Console](brahma-console.md) and [Autonomous Rooms](autonomous-rooms.md)

### Moderation

The Concierge's front desk --- who is asked when the usual providers decline, and how the result is shown.

- **On Duty**, **The Uncensored Desk**, **When a Provider Refuses**, **Display**
- Advanced: **Pre-Screening**

> See [The Concierge](the-concierge.md)

### Appearance

Where aesthetics meet functionality, and both are treated with the respect they deserve.

- **Appearance** (themes, colour mode), **Avatar Settings**, **Tags**

> See [Appearance Settings](appearance-settings.md) and [Tags Customization](tags-customization.md)

### Security

Saquel's strongroom: the passphrase, the lock, and the lever beneath the glass.

- **Encryption Passphrase**, **Auto-Lock**
- Advanced: **Delete All Data**

> See [Database Protection](database-protection.md) and [Deleting Your Data](system-delete-data.md)

### Data & Maintenance

The engine room and the filing cabinets.

- **Plugins**, **Backup & Restore**, **Import / Export**, **LLM Logging**, **LLM Logs**, **Tasks Queue**, **The Almanack (System Report)**

> See [Plugins](plugins.md), [Backup & Restore](system-backup-restore.md), [Import & Export Data](system-import-export.md), [Managing Tasks](system-tasks-queue.md), [LLM Logs](system-llm-logs.md) and [The Almanack](the-almanack.md)

## Quick Configuration Workflow

### Setting up Quilltap for the first time

1. **Connections** --- Run the Setup Wizard, or add a key and a connection profile from the **Providers** card
2. **Composer & Display** --- Arrange the Salon to your liking
3. **Images** (optional) --- Choose an artist for story backgrounds once you have an image profile
4. **Context & Memory** (optional) --- Tune what the characters remember

### Installing new capabilities

1. **Data & Maintenance → Plugins** --- Browse and install plugins
2. **Connections → Providers** --- Add any key or profile the new provider requires

## Estate Flavor

If you have an active theme installed, the household staff may answer to different names and wear different faces --- the Calliope of one theme might appear as "Visual Design" in another. Badges, lenses and search all follow the theme's names (search for the new name and you will find the same cards). The settings themselves are identical whatever the inhabitants choose to call themselves.

## Settings Persistence

All changes are saved automatically. You need not hunt for a "Save" button --- most settings update the moment you make a change, like a well-trained household staff that anticipates your every need.

### When changes take effect

- **Immediately:** Appearance, tags, chat preferences
- **On next chat:** Connection profile changes, plugin enablement
- **On next operation:** Image generation profile, embedding profile changes

"Immediately" is meant without asterisk, and includes conversations *already in
progress in another tab*. Adjust a Composer & Display preference here --- auto-scroll, the
display of a model's thinking, token counts, the inspector button, story
backgrounds --- and switch back to a chat you left open an hour ago: it will
have adopted your new arrangement while its back was turned, without losing a
word of a reply still arriving. There is no need to close the conversation and
open it again, and never was meant to be.

## Old Addresses Still Arrive

Bookmarks from the days of tabs (ending `?tab=chat`, or `?tab=system&section=plugins`) still arrive --- each is shown to the group and card where that setting now lives, so `?tab=chat&section=taboo` lands, correctly, under **Characters & Prompts**. The old `/foundry/<persona>` pages open that persona's lens. No link left behind, as they say.

## In-Chat Settings Access

Characters with help tools enabled can read your current settings aloud during a conversation, rather like a well-informed secretary who has memorized the contents of every filing cabinet. The `help_settings` tool accepts a `category` parameter with the following values:

- **`overview`** — A high-level summary of all configured profiles, counts, and key preferences
- **`chat`** — Token display, context compression, memory cascade, timestamps, and agent mode
- **`concierge`** — The Concierge's duty switch, uncensored desk, refusal rule, display and pre-screening settings
- **`connections`** — Your configured LLM providers and models (API keys are never disclosed)
- **`embeddings`** — Embedding and memory search profiles
- **`images`** — Image generation profiles and story background settings
- **`appearance`** — Theme preference, avatar settings, and sidebar width
- **`templates`** — Roleplay templates and the current default
- **`system`** — Plugin list and logging settings

To use it, simply ask a help-tools-enabled character something like "What are my current settings?" or "Show me my connection profiles," and the character will consult the appropriate category on your behalf.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings")`

## Troubleshooting

### Can't find a setting?

- Type a plain word for it into the search field (press **/**) --- "password", "dice", "backup" --- or the name of the member of staff you think minds it
- Choose a member of staff from the row above the rail to see everything they look after
- Some settings only appear after their prerequisites are configured (e.g., Image Profiles requires an API key first)
- Check whether a plugin provides additional settings you may need

### Changes aren't taking effect

- Refresh the page to ensure changes are loaded
- For connection changes, start a new chat or send a new message
- Verify that all required prerequisites are configured (API keys, etc.)
