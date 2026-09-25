---
url: /settings?tab=images&section=story-backgrounds
---

# Story Backgrounds

Story Backgrounds is a feature that automatically generates atmospheric background images for your chats, creating an immersive visual context for your conversations and roleplay sessions.

## How It Works

When enabled, Quilltap generates a landscape scene image featuring your characters whenever the Estate retitles a chat — the moment a new title is written being, by long custom, the Lantern's cue that the scene has shifted. The image appears as a subtle background behind your chat messages, adding atmosphere without interfering with readability.

### Generation Process

1. **Trigger**: A fresh background is commissioned whenever a chat's title actually changes at the hands of the automatic titler — whether at one of its periodic look-ins, when the Librarian folds older turns into the running summary and proposes a truer name for the evening, or when you tick **Use automatic naming** in the chat's rename dialog. A title typed in by hand does not summon the Lantern (use **Regenerate Background** for that), and a title that comes back unchanged commissions nothing, so the same scene is never painted twice.
2. **Scene Understanding**: The system determines the current scene in one of two ways:
   - **Scene State Tracker** (preferred): After every chat turn, a lightweight background task automatically tracks the current scene — where characters are, what they're doing, and what they look like. When this data is fresh (within 5 messages), the Lantern uses it directly, saving an extra LLM call.
   - **On-demand derivation** (fallback): If no recent scene state exists, the system reads your recent messages and asks a cheap LLM to describe the scene, much as a particularly attentive stage manager might.
3. **Casting**: Only characters presently in the scene are painted into it. A participant marked **Silent** is still standing there and duly appears; one marked **Absent**, or one shown the door altogether, does not — the Lantern declines to sketch a figure who has excused themselves from the room. Should every last participant have wandered off, no background is attempted at all, on the sensible grounds that an empty room furnishes poor atmosphere.
4. **Prompt Creation**: The system uses a cheap LLM to craft an atmospheric scene prompt based on the scene context and character appearances
5. **Image Generation**: The prompt is sent to your configured image generation profile
6. **Display**: The generated image appears as a semi-transparent background (30% opacity) behind your chat content

## Enabling Story Backgrounds

1. Go to the **Images** tab in Settings (`/settings?tab=images&section=story-backgrounds`)
2. Expand the **Story Backgrounds** card
3. Toggle **Enable Story Backgrounds** on
4. (Optional) Select a specific **Image Generation Profile** to use

If you don't select a specific profile, the system will use your default image generation profile.

## Requirements

- At least one image generation profile configured (see [Image Generation Profiles](image-generation-profiles.md))
- An active API key for your image provider
- Characters in your chat with physical descriptions (helps create better scenes)

## Tips for Best Results

### Character Descriptions
The more detailed your character's physical descriptions, the better they'll appear in backgrounds. Focus on:
- Physical appearance (height, build, hair, eyes)
- Typical clothing or attire
- Distinctive features

### Chat Titles
Chat titles are used as scene context. Descriptive titles like "Midnight conversation in the garden" produce better results than generic titles like "Chat 5".

### Image Profiles
Consider using an image profile with a model optimized for landscape/scene generation rather than portrait-focused models.

## Intimate Scenes and the Draped Sheet

A story that has wandered somewhere less than fully clothed presents the Lantern with a small difficulty of etiquette, and the answer depends entirely on which door the picture is going out through.

**Ordinary image providers.** Most houses will simply decline the commission, so the Lantern practises what one might call cinematic discretion. The scene is rendered honestly — the mood, the hour, the tousled bedding, the clothing on the floor — but the figure itself is arranged behind a sheet slipped just so, a bedpost, a shoulder turned away, a doorway's shadow, or the merciful steam of a bath. Nothing about the story is altered; the camera has merely learned some manners. What the Lantern will *never* do is put everyone back into pyjamas and pretend a different evening took place.

**Uncensored image providers.** If the conversation is **Unmoderated**, you have nominated an uncensored image profile to the Concierge (**Chat** tab in Settings, `/settings?tab=chat&section=dangerous-content`), and the Concierge is on **Auto-Route**, the drapery is dispensed with. There is no moderation to slip past at that door, so the Lantern describes the scene plainly instead of arranging occlusions nobody asked for. The framing rules survive intact — this remains a wide, calm background with the figures toward the edges of the frame, never an anatomical study. Under Detect Only the sheet stays put: the picture cannot be carried to the uncensored door, so there is no point drafting it for one.

**When a provider changes its mind.** Should an ordinary provider decline the commission on moderation grounds, the Concierge — on Auto-Route, and in any chat not **Locked** — carries the *same* prompt across the street to an uncensored image profile: the one you named, or failing that any profile ticked "Uncensored-compatible". The prompt is never rewritten on the way; a Moderated chat's backdrop arrives still wrapped in its sheet, merely painted by a less squeamish hand. The Concierge leaves a note in the chat either way, and the Lantern's announcement lists the painter who declined above the one who obliged. See [Dangerous Content Handling](dangerous-content.md) for the whole of the rule.

## Project Backgrounds

A project may wear one of two faces:

- **Theme**: No background image (uses your theme colors)
- **Latest Chat**: Automatically uses the most recent chat's background

Set the mode on the project's own page, in the **Image Generation** card under **Story Backgrounds**. In **Theme** mode the project page falls back to whatever decorative backdrop your theme gives the Prospero section, exactly as the projects list does; **Latest Chat** replaces it with the most recently generated background from any conversation in the project.

Two further options — **Project-generated background** and **Static uploaded image** — were struck from the menu in 4.9, having been advertised without ever having been built. Neither could produce a picture: the first read a slot only the Latest Chat machinery ever filled, and the second read a slot nothing filled at all, there being no means anywhere in the building to upload such an image. A project left in either mode now shows its theme backdrop, which is precisely what it was showing before, only now the menu has the decency to admit it.

When a project is open beside a conversation in a split workspace, the conversation's background wins the whole screen; the project's background returns when you close or move away from that conversation.

## Performance Notes

- Background images are generated as background jobs, so they won't slow down your chat
- Images are cached and don't re-generate unless the title changes
- A chat you have renamed by hand keeps its name: neither the periodic titler nor the Librarian's summary will overwrite it. Tick **Use automatic naming** in the rename dialog to hand the naming back to the Estate
- The feature can be disabled at any time without affecting existing backgrounds

## Troubleshooting

**Background not appearing:**
- Check that Story Backgrounds is enabled in the **Images** tab in Settings (`/settings?tab=images&section=story-backgrounds`)
- On a project page, check the project's background display mode — in **Theme** mode the project shows the theme's backdrop rather than a generated one
- In **Latest Chat** mode, at least one chat in the project must already have a generated background
- Verify your image profile has a valid API key
- Check the Tasks Queue for any failed generation jobs

**Low quality backgrounds:**
- Try a different image generation model
- Ensure characters have detailed physical descriptions
- Use more descriptive chat titles

**Generation failing:**
- Check your image provider API key is valid and has credits
- Review the Tasks Queue for error messages
- Try a different image profile

## In-Chat Settings Access

Characters with help tools enabled can read your story backgrounds configuration during a conversation using the `help_settings` tool with `category: "images"`. This returns your image generation profiles and story background settings. Ask a help-tools-enabled character something like "Are story backgrounds enabled?" and it will consult the records.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=images&section=story-backgrounds")`

## Related Topics

- [Image Generation Profiles](image-generation-profiles.md)
- [Chat Settings — The Staff Behind the Scenes](chat-settings-ai-services.md#story-backgrounds-settings)
- [Projects](projects.md)
