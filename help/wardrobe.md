---
title: The Wardrobe
url: /aurora
tags: [characters, wardrobe, outfit, clothing, appearance, tools]
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

A character may have many items in each slot but can equip only one per slot at a time (with the exception of accessories, where layering is half the fun).

## Creating Wardrobe Items

To furnish a character's wardrobe:

1. Navigate to **Aurora** (the Characters page)
2. Open a character and look for the **Wardrobe** section
3. Click to add a new wardrobe item
4. Choose the **slot** (top, bottom, footwear, or accessories)
5. Give the item a **name** (e.g., "Burgundy velvet smoking jacket")
6. Provide a **description** --- as lavish or as terse as you please --- that the AI will use when referencing the garment

You may also edit or remove items at any time. The wardrobe is yours to curate, though your characters may have opinions about it (see below).

## Characters and Their Wardrobe Tools

During a chat, characters with the appropriate permissions can interact with the wardrobe using three tools:

- **list_wardrobe** --- Browse all available items in the character's wardrobe
- **update_outfit_item** --- Swap an equipped item for a different one from the wardrobe
- **create_wardrobe_item** --- Invent an entirely new garment and add it to the wardrobe

For models that do not support tool use natively, characters may invoke these capabilities using text-block syntax: `[[WARDROBE]]`, `[[EQUIP]]`, and `[[CREATE_WARDROBE_ITEM]]`.

### The Wardrobe Flags

Two flags on each character govern what they are permitted to do with their own clothing:

- **canDressThemselves** --- When enabled (the default), the character may use `list_wardrobe` and `update_outfit_item` to browse and change their outfit during conversation. Disable this if you prefer to maintain strict authorial control over what they wear.
- **canCreateOutfits** --- When enabled (also the default), the character may use `create_wardrobe_item` to fabricate new garments on the fly. This is delightful for characters with a flair for fashion, but you may wish to disable it if your character's wardrobe should remain fixed.

Both flags can be found in the character's settings on the Aurora page.

## Outfit Selection When Starting a Chat

When you begin a new conversation, you will be asked how to handle the character's outfit:

- **Default** --- The character starts wearing whatever they had equipped in their most recent chat (or their full wardrobe if no prior chat exists)
- **Manual** --- You hand-pick which items the character is wearing at the start of the scene
- **None** --- The character begins with no equipped outfit; what they wear (if anything) is left to the narrative

This ensures that every conversation starts with the appropriate sartorial context, whether your character is attending a gala or has just tumbled out of bed.

## How the Wardrobe Affects Image Generation

When Quilltap generates images of a character --- whether through the Lantern background system or direct image generation --- it consults the currently equipped wardrobe items rather than any legacy clothing description. Each equipped item's description is fed to the image provider, so what the character is *actually wearing* in the conversation is what appears in the picture.

If no wardrobe items are equipped, the system falls back gracefully to the character's legacy clothing description, so nothing breaks for characters who have not yet been fitted with a proper wardrobe.

## Migration from Legacy Clothing

If your characters already have clothing descriptions from before the Wardrobe system existed, fear not: Quilltap automatically migrates those descriptions into wardrobe items as full-coverage outfits. The original `clothingRecords` data is preserved, so nothing is lost in the transition. Think of it as unpacking a steamer trunk into a proper armoire --- everything is still there, just better organized.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Topics

- [Tools](tools.md) - Overview of AI tools available in Quilltap
- [Using Tools in Chat](tools-usage.md) - How tools work during conversation
- [Characters](characters.md) - General character management
