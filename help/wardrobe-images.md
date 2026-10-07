---
title: Wardrobe Images
url: /settings?tab=images&section=wardrobe-images
tags: [wardrobe, images, image generation, settings, concierge]
---

# Wardrobe Images

> **[Open this page in Quilltap](/settings?tab=images&section=wardrobe-images)**

Every garment and outfit in the Wardrobe may sit for its portrait (see [Portraits of the Garments](wardrobe.md#portraits-of-the-garments)). The **Wardrobe Images** card on the **Images** tab of Settings decides who holds the brush.

## Choosing the Wardrobe Artist

The card holds a switch and a picker.

## Portraits from the Wardrobe Tools

When characters are permitted to make and amend their own garments (`wardrobe_create` and `wardrobe_update` --- see [The Wardrobe](wardrobe.md#tools-for-characters)), they may also send the result round to the artist. Whether they may is entirely your affair: the **Portraits from the Wardrobe Tools** switch is off until you tick it, because every sitting is a paid commission nobody clicked for.

With the switch **on**:

- A garment a character runs up with `wardrobe_create` is drawn as a matter of course, unless the character expressly declines.
- An amendment through `wardrobe_update` that changes how the item looks --- its name, its Portrait Cue, its coverage, or an outfit's components --- has it drawn afresh. A change of description or appropriateness alone does not; the character may still ask for a new sitting outright.
- The drawing is done in the background (the **Img** chip lights while it works), by the Wardrobe Artist below, with the Concierge standing by exactly as for a picture you commission yourself. The character is told it is under way and carries on with the scene.

With the switch **off**, nothing is drawn, and a character who asks is told, politely, that the house does not permit it.

## Choosing the Wardrobe Artist

The **Wardrobe Artist** picker chooses which image profile draws the garments when you press **Generate** in an item's editor, or **Generate image** on its ⋮ menu.

- **The default image profile** (the first choice) means exactly that: whichever profile you have starred as your default image profile does the drawing.
- **Any other profile** becomes the designated wardrobe artist. Profiles marked *(uncensored)* are the ones ticked "Uncensored-compatible".

Some image providers take a dim view of a garment shown on its own --- the odd corset has been known to cause a fainting fit at the more respectable studios --- so it is worth naming a desk that will not balk. Should the chosen artist refuse anyway, the Concierge carries the commission to his uncensored desk (set on **The Concierge** tab), provided he is on duty and such a desk is named; the item's editor then notes that the picture was rerouted. If no one will take the commission, the editor says so and lets you try another profile.

This choice is deliberately separate from the Lantern's backdrop desk under **Story Backgrounds**: a profile chosen for sweeping landscapes is not necessarily the one you want painting waistcoats.

The editor's **▾** beside **Generate** overrides the artist for a single sitting without changing this setting.

## How Characters See the Pictures

`wardrobe_list` and `wardrobe_read` show, beside any item that has a picture, its **image file id**. A character hands that id to `describe_image` to learn what the picture shows --- usually instantly, since the prompt that drew it is on file --- or to `keep_image` to file it in their own album, whence `attach_image` can hold it up to the room.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=images&section=wardrobe-images")`

## Related Topics

- [The Wardrobe](wardrobe.md) --- items, outfits, and their portraits
- [Image Generation Profiles](image-generation-profiles.md)
- [The Concierge](the-concierge.md) --- the uncensored desk
- [Story Backgrounds](story-backgrounds.md)
