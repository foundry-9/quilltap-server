---
title: The Wardrobe
url: /aurora
tags: [characters, wardrobe, outfit, clothing, appearance, tools, image, import, vision]
---

# The Wardrobe

> **[Open this page in Quilltap](/aurora)**

One does not simply *describe* a character's attire in a single breathless paragraph and call it a day --- not in a civilized establishment such as this. The Wardrobe system grants your characters a proper, itemized collection of garments: tops, bottoms, footwear, and accessories, each catalogued with the precision of a Savile Row tailor and the creative latitude of a Montmartre costumier. Characters may mix, match, and swap individual pieces mid-conversation, and --- should you permit it --- even conjure entirely new ensembles from the gossamer threads of their own imagination.

## What the Wardrobe System Does

Rather than storing a character's clothing as a single monolithic block of descriptive text (the sartorial equivalent of stuffing everything into a steamer trunk), the Wardrobe breaks attire into discrete **wardrobe items**, each assigned to a slot. These items can be equipped, swapped, or removed independently, giving both you and the AI fine-grained control over what a character is wearing at any given moment.

The equipped outfit travels with each chat, so a character might be wearing a ballgown in one conversation and workshop overalls in another --- precisely as the narrative demands.

## Wardrobe Slots

Every wardrobe item belongs to one of four slots, which together compose a complete outfit:

| Slot | What It Covers | Examples |
|------|---------------|----------|
| **Top** | Upper-body garments | Blouses, jackets, waistcoats, corsets, cloaks |
| **Bottom** | Lower-body garments | Trousers, skirts, kilts, petticoats |
| **Footwear** | Shoes, boots, and the like | Oxfords, riding boots, ballet slippers, bare feet |
| **Accessories** | Everything else | Hats, gloves, jewellery, monocles, pocket watches, scarves |

A character may have many items in each slot, and equip multiple of them at once — a t-shirt under a sweater, a dress shirt beneath a waistcoat. The system trusts the LLM (and your own scene-setting) to decide what shows. List them inner-to-outer when it matters; layering is half the fun.

## Creating Wardrobe Items

To furnish a character's wardrobe:

1. Navigate to **Aurora** (the Characters page)
2. Open a character and look for the **Wardrobe** section
3. Click to add a new wardrobe item
4. Choose the **slot** (top, bottom, footwear, or accessories)
5. Give the item a **name** (e.g., "Burgundy velvet smoking jacket")
6. Provide a **description** --- as lavish or as terse as you please --- that the AI will use when referencing the garment

You may also edit or remove items at any time. The wardrobe is yours to curate, though your characters may have opinions about it (see below).

## The Wardrobe Control Dialog

For day-to-day fussing-about with what a character is wearing, there is a more direct instrument than the Aurora page's tabs and panels: the **Wardrobe** dialog. A small clothes-hanger icon dwells on the left sidebar (between Themes, when shown, and Settings) and is accessible from every page that bears the sidebar — Salon, Aurora, Prospero, the Foundry, and so on.

What the dialog allows you to do, with the directness of a valet pulling out the morning's tweeds:

- **Pick any character** from a single dropdown at the top — the dialog needn't be tied to whoever is presently speaking in a chat.
- **Browse the wardrobe** in full: filter by slot, mark items as **default** (a star toggle), edit them in place, delete them, or compose new ones.
- **Build composite items** — a "Rain Outfit" that bundles a raincoat, jeans, and boots; a "Nice Jewellery" set comprising earrings, locket, and ring. The editor's *Composes* panel lets you pick existing items as components; the system computes the slot coverage automatically and refuses to allow circular bundles.
- When opened **inside a chat**, a second column appears with two tabs:
  - *Wearing now* — what this character is actually wearing in the chat. Each slot lists what is currently equipped as removable chips; a small **+** opens a picker to add items (use **Replace** to swap or **Add** to layer); a **Clear** button empties the slot. Composite items are shown as a single chip with a "composite" note. Edits to this tab **stage** in the dialog and are committed all at once when you click **Done** (or close the dialog) — Aurora announces the change exactly once and the avatar regenerates exactly once, no matter how many slots you fussed with along the way. If your final state happens to match what the character was already wearing, nothing is committed and nothing is announced.
  - *Fitting room* — a virtual outfit just for the avatar generator. Edits here never reach the chat unless you say so. Buttons let you reset the fitting room from what the character is currently wearing, from their default-outfit items, or to clear it entirely. A **Wear this** button (in chat only) commits the whole composition at once, replacing what the character is wearing — Aurora announces the change, the avatar regenerates against the new outfit, and the dialog closes itself with the work complete.
- Wardrobe rows on the left switch their action labels based on which tab is active: *Wear* / *+ Layer* live in the *Wearing now* tab; *Try on* / *+ Add* push the same items into the fitting room without committing.
- Out of chat, only the *Fitting room* tab appears. It is seeded from the character's defaults so a click of **Generate avatar** has something to work with even before you fuss with it.
- **Generate a new avatar** with a model of your choosing. The fitting-room outfit is what the avatar generator sees — meaning you can compose a never-before-worn outfit, take a portrait of it, and never disturb the character's actual chat state. In a chat, the new portrait replaces the character's avatar in that conversation only (the chat's default model is not touched). Out of chat, the dialog produces a downloadable preview and saves nothing to the character's avatar record.

The Wardrobe dialog supersedes the per-participant outfit dropdowns and the standalone "Gift Item" modal that previously lived in the participant sidebar. The same operations remain reachable, but with rather more elbow room.

### Import from Image

For those moments when visual inspiration strikes --- a photograph discovered in one's research, a portrait from a fashion plate, a screenshot from a film --- Quilltap can analyze a reference image and propose wardrobe items derived from whatever garments are visible therein. It is rather like having a couturier examine a daguerreotype and reproduce the ensemble, stitch by stitch.

To use this feature:

1. Navigate to a character's **Appearance** tab
2. In the **Personal Wardrobe** section header, click the **image icon** button (beside "Add Item")
3. Drop an image file into the upload zone, or click to browse (JPEG, PNG, WebP, or GIF, up to 10 MB)
4. Optionally provide **guidance notes** --- free-text hints to steer the analysis (e.g., "this is a medieval fantasy setting," "focus on the woman on the left," "ignore the background characters")
5. Click **Analyze Image**

A vision-capable LLM will examine the image and return a list of proposed wardrobe items, each with a suggested title, description, slot type(s), and appropriateness tags. You are then presented with a review screen where you may:

- **Edit** any field (title, types, appropriateness, description) before importing
- **Deselect** items you do not wish to import
- **Re-analyze** the image if the results are unsatisfactory

Click **Import Selected** to add the approved items to the character's personal wardrobe. They are created as non-default items --- you may mark them as defaults or equip them afterwards, at your leisure.

**Requirements:** This feature requires at least one vision-capable provider to be configured (Anthropic Claude, OpenAI GPT-4o, Google Gemini, or xAI Grok). If you have configured an **Image Description Profile** in your Chat settings, that profile will be used; otherwise Quilltap will select any available vision-capable provider from your connection profiles.

### Shared Items (Archetypes)

Some garments transcend the boundaries of any single wardrobe. A Roman legionary's tunic, a proper Edwardian morning suit, or a pair of sensible Wellington boots --- these are the sort of items that any character might reasonably don, regardless of their personal collection.

**Shared items** (also known as archetypes) are wardrobe items not bound to any particular character. Any character may equip them directly, without the tedium of maintaining duplicate entries. To create a shared item, check the "Shared item" checkbox when adding a new garment. Shared items appear in a separate "Shared Wardrobe" section beneath each character's personal collection.

### Composite Items (Bundled Outfits)

Rather than selecting each garment individually every time a character must dress for an occasion, you may compose a single wardrobe item out of *other* wardrobe items. A "Garden Party Attire" composite might bundle a linen blazer, white slacks, and oxfords; a "Nice Jewellery" composite might bundle a pair of earrings, a locket, and a ring. The composite itself is a wardrobe item like any other — it covers whichever slots its components do, and equipping it places the bundle in those slots in one tidy gesture.

To create one, add a wardrobe item as you ordinarily would, then in its details note the constituent items. The system protects against curious accidents (an item containing itself, or a circular reference between two items) by quietly refusing to save such arrangements.

Composites used to be called "outfit presets" and lived as a separate species. They have been folded into the wardrobe, sparing the curator one extra concept to mind. Existing presets are migrated to composite items automatically, with their identities preserved.

### Archiving and Deletion

Items that have fallen out of favour need not be destroyed entirely. **Archiving** an item hides it from wardrobe lists and tool results while preserving it for posterity --- and it will remain equipped if currently worn, so mid-conversation wardrobe crises are averted. Should you wish to restore an archived item, simply unarchive it.

**Permanent deletion** removes an item entirely and cleans up references in equipped slots across all chats. Any composite that bundled the deleted item will tolerate the absence gracefully — the dangling reference is dropped at read time without disturbing the rest of the bundle.

## Characters and Their Wardrobe Tools

During a chat, characters with the appropriate permissions can interact with the wardrobe using four tools:

- **list_wardrobe** --- Browse all available items in the character's wardrobe (composites are flagged as such, with their components listed)
- **wardrobe_change_item** --- Adjust a single garment. Modes: `equip` (swap a single item into the slots it covers), `add_to_slot` (layer an item over what is already worn), `remove_from_slot` (take off one specific item), `clear_slot` (empty a slot entirely). Refuses composite outfits — those have their own tool
- **wardrobe_set_outfit** --- Wear or remove a composite outfit (a wardrobe item that bundles multiple pieces, like a "Rain Outfit" containing coat, jeans, and boots). Modes: `wear` (put the bundle on, replacing what was in those slots) and `remove` (take the bundle off). Refuses single garments — use `wardrobe_change_item` for those
- **create_wardrobe_item** --- Invent an entirely new garment and add it to the wardrobe, OR compose a new outfit out of existing items by supplying `component_item_ids` or `component_titles` (a composite). You may also **gift one to another character** in the chat

For models that do not support tool use natively, characters may invoke these capabilities using text-block syntax: `[[WARDROBE]]`, `[[CHANGE_ITEM]]`, `[[SET_OUTFIT]]`, and `[[CREATE_WARDROBE_ITEM]]`.

### Gifting Wardrobe Items

A character may, with suitable generosity and the `canCreateOutfits` permission, conjure a garment not merely for their own wardrobe but for that of another character in the conversation. This is accomplished by specifying a **recipient** when creating a wardrobe item --- the newly minted garment is placed directly into the recipient's collection, and may optionally be equipped upon them at once.

From the **user's** perspective, a small gift icon appears beside the **Outfit** header on each character's participant card in the sidebar. Clicking it opens a form where you may design a new wardrobe item and bestow it upon that character --- complete with the option to have them don the gift immediately. This is rather like having a personal couturier on retainer, dispatching bespoke garments to your cast of characters at a moment's notice.

For models using text-block syntax, gifting uses the `recipient` attribute: `[[CREATE_WARDROBE_ITEM title="Red Scarf" types="accessories" recipient="CharacterName"]]A gift for you[[/CREATE_WARDROBE_ITEM]]`.

### The Wardrobe Flags

Two flags on each character govern what they are permitted to do with their own clothing:

- **canDressThemselves** --- When enabled (the default), the character may use `list_wardrobe` and `update_outfit_item` to browse and change their outfit during conversation. Disable this if you prefer to maintain strict authorial control over what they wear.
- **canCreateOutfits** --- When enabled (also the default), the character may use `create_wardrobe_item` to fabricate new garments on the fly. This is delightful for characters with a flair for fashion, but you may wish to disable it if your character's wardrobe should remain fixed.

Both flags can be found in the character's settings on the Aurora page.

## Outfit Selection When Starting a Chat

When you begin a new conversation, you will be asked how to handle the character's outfit:

- **Default** --- The character starts wearing whatever they had equipped in their most recent chat (or their full wardrobe if no prior chat exists)
- **Manual** --- You hand-pick which items the character is wearing at the start of the scene
- **Let Character Choose** --- The character examines the scenario and their own wardrobe, then selects what seems most appropriate for the occasion. This is accomplished by a discreet consultation with the AI before the conversation begins --- rather like sending one's valet ahead to assess the dress code. Should the consultation fail for any reason (a misplaced cufflink, an uncooperative telegraph), the character simply falls back to their default outfit with admirable composure.
- **None** --- The character begins with no equipped outfit; what they wear (if anything) is left to the narrative

If you have also chosen a **Play As** character to represent yourself in the conversation, that character appears in the outfit selector too --- so you may dress your own persona alongside the cast, sparing yourself the indignity of arriving at a gala in whatever you happened to be wearing at your last engagement.

This ensures that every conversation starts with the appropriate sartorial context, whether your character is attending a gala or has just tumbled out of bed.

## How the Wardrobe Affects Image Generation

When Quilltap generates images of a character --- whether through the Lantern background system or direct image generation --- it consults the currently equipped wardrobe items rather than any legacy clothing description. Each equipped item's description is fed to the image provider, so what the character is *actually wearing* in the conversation is what appears in the picture.

If no wardrobe items are equipped, the system falls back gracefully to the character's legacy clothing description, so nothing breaks for characters who have not yet been fitted with a proper wardrobe.

## Aurora's Wardrobe Announcements

Whenever a character's outfit changes during a chat --- whether you yourself adjust a slot from the sidebar, gift a freshly-tailored garment with the equip-now option ticked, or the character themselves invokes the `update_outfit_item` tool --- Aurora will quietly take note. After a polite minute of stillness (long enough for you to fuss with all four slots without setting off a flurry of announcements), she steps in with a brief Markdown summary of the present ensemble, addressed to everyone at the table. The wait resets each time another change lands, so she only speaks once the dust has truly settled.

These announcements appear as ordinary chat messages attributed to Aurora and are visible to every character in the conversation, ensuring nobody is left guessing about who is now wearing what.

## Per-Conversation Avatars

Should you wish it, Quilltap can generate fresh character portraits whenever an outfit changes --- a sort of automated daguerreotype service, if you will. When enabled, each outfit change triggers a background portrait generation that reflects the character's current ensemble. The resulting avatar appears alongside their messages, creating a visual chronicle of the character's sartorial journey through the conversation.

To enable this feature, look for the **Auto-Generate Avatars** toggle in your chat settings. Note that each portrait costs an image generation API call, so this feature is entirely opt-in --- one does not wish to receive an unexpectedly large bill from one's portraitist.

The generated avatars update asynchronously: the chat continues without interruption, and the new portrait appears once the image provider has finished its work. Previous messages retain whatever avatar was current at the time, so scrolling backwards through the conversation reveals each costume change in sequence.

## Migration from Legacy Clothing

If your characters already have clothing descriptions from before the Wardrobe system existed, fear not: Quilltap automatically migrates those descriptions into wardrobe items as full-coverage outfits. The original `clothingRecords` data is preserved, so nothing is lost in the transition. Think of it as unpacking a steamer trunk into a proper armoire --- everything is still there, just better organized.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Topics

- [Tools](tools.md) - Overview of AI tools available in Quilltap
- [Using Tools in Chat](tools-usage.md) - How tools work during conversation
- [Characters](characters.md) - General character management
