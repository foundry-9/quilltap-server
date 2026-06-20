---
url: /settings?tab=images&section=default-aesthetics
---

# Default Aesthetics — A House Style for Every Picture

Left to its own devices, the Lantern paints each picture in whatever manner the moment suggests, and so an avatar, a story background, and a character's conjured snapshot may arrive looking as though they hailed from three different ateliers. The **Default Aesthetics** put an end to that disorder. Compose a few lines of free-form guidance once — *"everything here is rendered as 1920s art-deco illustration,"* or *"anime,"* or *"swords-and-sorcery oil painting"* — and that house style is woven into the prompt for every image the establishment produces.

There are **two** such instructions, because a picture has two concerns that rarely wish to be governed by the same hand:

- **Default Image Aesthetic** — the look of the *scene itself*: medium, era, palette, the quality of the light. This guides story backgrounds and any ad-hoc image a character summons with the `generate_image` tool.
- **Default Character Aesthetic** — the manner in which *people and their attire* are depicted. This guides character avatars, and also the figures who appear within story backgrounds and ad-hoc images.

The two resolve **independently**, so you may dress your people in one tradition while setting your scenes in another.

## Where they live

Both fields await you on the **Images** settings tab, in the **Default Aesthetics** card. Each is a proper Markdown editor; write as plainly or as floridly as you please, and press **Save**. Clearing a field and saving removes the instruction altogether.

These are not hidden settings squirreled away in some ledger — each field is simply a tidy view onto a file in your **Quilltap General** document store (`lantern-aesthetics.md` and `aurora-aesthetics.md`). Should you prefer to drop those files in by hand, through the Scriptorium or otherwise, they will be honored exactly the same.

## Per-project overrides

A project may keep its own house style. Visit the project's page (Prospero), open the **Image Generation** card, and you will find the same two fields. Whatever you write there governs that project's images and **overrides** the global instruction — per file, and only for that project. Leave a project field empty and it quietly inherits the global default instead. A project may thus override the character aesthetic while contentedly inheriting the global scene aesthetic, or any combination you like.

## The Ariel Clause — a character's own terms

Some characters care a great deal about how they are shown — and not as a matter of mere taste, but as a standing condition. For these, place a file named **`depiction-guidelines.md`** in the character's own vault (via the **Depiction Guidelines** field on the character's edit page, under *Descriptions*, or by dropping the file in directly).

Whenever that character appears in a **story background** or an **ad-hoc image**, their guidelines are passed along to the image-prompt writer as a **mandatory instruction**, plainly attributed to them by name. They are never quietly omitted, they never replace the general aesthetic — they sit atop it — and where the two disagree, the character's own terms prevail. Should several such characters share a frame, each one's guidelines travel with them.

A few points of etiquette worth remembering:

- Depiction guidelines apply to **story backgrounds and ad-hoc images only** — never to plain avatars. (In practice a character seldom frets over their avatar, but minds a great deal how they appear in a scene.)
- They are read **only** from the character's own vault. They pay no heed to project or global tiers.
- A character must possess a document vault before guidelines can be stored. New characters are furnished with one automatically; if an older character lacks one, simply save them once to provision it.

## In-Chat Navigation

```
help_navigate(url: "/settings?tab=images&section=default-aesthetics")
```
