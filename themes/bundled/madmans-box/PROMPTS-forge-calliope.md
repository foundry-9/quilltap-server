# Madman's Box — Forge & Calliope background prompts

Two image-generation prompts to finish the Madman's Box subsystem background set.
The theme's `theme.json` already references `textures/forge-bg.webp` and
`textures/calliope-bg.webp` under the `forge` and `calliope` subsystem keys — these
are the last two missing files.

**Output target (match the existing six exactly):**

- **Dimensions:** 2752 × 1536 px (16:9, ~1.79:1)
- **Format:** `.webp` (convert with `cwebp -q 82 -m 6 -mt in.png -o out.webp`, then delete the PNG)
- **Filenames:** `forge-bg.webp`, `calliope-bg.webp`, dropped into this `textures/` folder
- **Concept:** rooms aboard a TARDIS-like vessel — "bigger on the inside, and dressed
  for the occasion" — not "staff who work for you"

**Shared visual grammar pulled from the existing set (keep all of these):**

- One glowing hero object roughly dead-center
- Dark-walnut-and-brass base; warm amber lamplight; cool phosphor-cyan for screens/energy;
  banker's-lamp green only where things "go right"
- A portal, window, or impossible view onto an elsewhere
- Faint engraved glyph-script as texture on rims, plaques, or panels
- Painterly, cinematic, atmospheric — not flat UI art; "dark by decree, never by accident"

**Palette anchors (from `styles.css`):**
walnut `hsl(28 32% 7%)` · walnut-panel `hsl(28 30% 11%)` · brass `hsl(40 72% 52%)` ·
brass-light `hsl(42 70% 66%)` · phosphor-cyan `hsl(184 78% 50%)` · lamp-green `hsl(140 52% 42%)` ·
warning-amber `hsl(38 92% 54%)` · accent-magenta `hsl(310 56% 58%)`

---

## 1. The Forge — `forge-bg.webp`

*(Providers / API keys — the engine room and the vault of keys. Saquel Ytzama, Keeper of Secrets, lives here too.)*

> The engine room of a mad inventor's time machine, rendered in dark walnut and aged
> brass. Dead center stands the heart of the vessel: a tall glowing rotor-column of
> stacked glass and brass rings, amber light pulsing up its length, a Jacob's ladder of
> cyan electricity crackling between two posts beside it. Wrapping the core, a great
> curved switchboard — a wall of labeled brass connection-ports and valves, each a
> different "line" feeding the central furnace, fat braided cables and copper pipes
> converging inward like the arms of a furnace. To one side, the keeper's domain: a
> heavy riveted iron safe-door, half-open, and a board hung with a ring of ornate
> antique keys catching the firelight. The room runs hotter than the rest of the
> vessel — more orange flame-glow spilling from a grate low in the frame, vacuum tubes
> aglow with amber along the panels, a banker's-lamp green where one gauge reads true.
> Faint engraved glyph-script runs along the brass rims and the port-labels. Bakelite
> knobs, brass dials, walnut paneling. Warm and lamplit, deep shadows, painterly and
> cinematic, atmospheric depth. 16:9 widescreen. No text, no people, no logos.

**Why these elements:** the rotor-column is the "what makes the vessel go" hero object;
the switchboard of labeled ports *is* the provider list (OpenAI / Anthropic / Grok /
Google / Ollama as physical lines into one furnace); the safe-door and key-ring are
Saquel's secrets/API-key vault. Hotter palette distinguishes it as the one room where
you see the flame.

**Tuning knobs if a first pass misses:**

- More provider-ness → emphasize "five distinct cables of different colors, each
  plugged into its own labeled brass socket on the switchboard."
- More vault-ness → emphasize the safe-door and key-ring in the foreground, push the
  rotor slightly back.
- Too busy → drop the Jacob's ladder, keep the rotor + switchboard + key-ring.

---

## 2. Calliope — `calliope-bg.webp`

*(Themes / look-and-feel — the room that changes how the whole vessel appears.)*

> A curved chamber aboard a time-machine vessel whose own walls are visibly changing
> their style — the room where the ship tries on its own faces. The paneling shifts
> from segment to segment: one curved wall-panel rendered in opulent Art Deco gold and
> navy, the next in muted sage-green and cream, the next in the deep dark-walnut-and-brass
> of the home palette, as though the room is dialing through its own skins. Dead center,
> the hero apparatus: a great brass color-organ — part stained-glass orrery, part lens-
> and-filter machine — throwing fans of colored light, a rainbow spray of phosphor-cyan,
> amber, magenta, and gold across the curved surfaces and the polished floor. A tailor's
> mannequin draped in shifting iridescent fabric stands to one side, half-caught between
> two styles. Brass swatch-plates and tinted lens-discs hang on a rack like a painter's
> palette of light. The base of everything stays dark walnut and brass and lamplit, even
> as the secondary colors riot. Faint engraved glyph-script along the brass rims. Bakelite
> knobs and dials on the color-organ. Painterly, cinematic, atmospheric, deep shadows.
> 16:9 widescreen. No text, no people's faces, no logos.

**Why these elements:** Calliope governs *appearance*, so the room reskins itself — the
walls cycling through actual Quilltap themes (Art Deco, Earl Grey, Madman's Box) makes
the function legible. The color-organ throwing colored light is the strongest possible
echo of the Lantern's rainbow projection (your best existing color moment) without
copying it. The draped mannequin ties to Aurora's wardrobe without duplicating that room.

**Tuning knobs if a first pass misses:**

- Walls not reading as "themes" → name the styles explicitly: "left panel Art Deco gold,
  center panel sage-and-cream, right panel dark walnut and brass."
- Too close to the Lantern → swap the color-organ for a stained-glass orrery and lead
  with the swatch-plate rack instead of the light-spray.
- Too close to Aurora's wardrobe → drop the mannequin, keep the color-organ + shifting
  walls.

---

## After generating

1. Confirm each render is 2752 × 1536 (crop/upscale if the generator returns 16:9 at a
   different size).
2. `cwebp -q 82 -m 6 -mt forge.png -o forge-bg.webp` (and likewise for calliope), then
   delete the PNGs.
3. Drop both `.webp` files into this `textures/` folder. No `theme.json` edit needed —
   the `forge` and `calliope` subsystem keys already point at these filenames.
