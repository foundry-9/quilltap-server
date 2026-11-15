---
url: /settings?section=appearance
---

# Themes

> **[Open this page in Quilltap](/settings?section=appearance)**

Themes control the overall look and feel of Quilltap, including colors, fonts, and visual styling. You can switch between the built-in default theme, the themes that ship with Quilltap, and custom themes installed as `.qtap-theme` bundles, and customize your preferred color mode (light, dark, or system).

## What Are Themes?

A theme is a complete visual design for Quilltap that includes:

- **Color scheme** — Primary, secondary, accent, and background colors for light and dark modes
- **Typography** — Font families used for headings and body text
- **Component styles** — Visual appearance of buttons, cards, inputs, and other UI elements
- **Icon overrides** — Custom glyphs replacing any of the application's standard icons (`.qtap-theme` bundles only)
- **Dark mode support** — Some themes provide separate styling for light and dark modes

Quilltap comes with a built-in default theme and a small wardrobe of bundled themes, and can be extended with custom themes uploaded as `.qtap-theme` bundles.

## Available Themes

### Default Theme

Quilltap includes a carefully designed default theme featuring:

- A clean, professional color palette
- Excellent readability in both light and dark modes
- Consistent component styling
- Optimized for creative work and long writing sessions

The default theme is always available and serves as a fallback if no other theme is selected.

### Themes Tailored for an Earlier Quilltap

The present establishment wears one cut of theme only: the `.qtap-theme` bundle of the current format (its `theme.json` says `"formatVersion": 2`). Two older garments are no longer admitted:

- **A version 1 bundle** — one installed under an earlier Quilltap, whose manifest carried its colours inline or declared `"formatVersion": 1`.
- **A theme supplied by a plugin** — the plugin itself still loads and goes on doing whatever else it does; only its theme is turned away.

Neither is registered, and neither is deleted on your behalf. Instead each is listed on the Appearance card under **Garments Left at the Door**, with its name, the version or plugin it came from, a word of explanation, and a button to this page. A version 1 bundle also wears an **Uninstall** button, should you care to clear it from the cloakroom; a plugin's theme departs when you remove the plugin from the Plugins card.

**If your chosen theme was one of these**, Quilltap returns quietly to the Default theme and says so once, in a notice at the corner of the screen. Pick another theme from the shelf whenever you please; your colour mode is untouched.

**To wear such a theme again**, it must be remade in the current format — its author is the best person for the job. To start one of your own, `npx create-quilltap-theme my-theme` scaffolds a fresh bundle.

### Theme Bundles (.qtap-theme)

Theme bundles are a simpler way to distribute and install themes. A `.qtap-theme` file is a zip archive containing:

- **theme.json** — The theme manifest: name, version, author and which files the bundle holds
- **tokens.json** — The design tokens: colours, fonts, spacing and the like, for light and dark
- **CSS files** — Optional style overrides
- **Font files** — Custom fonts (.woff2, .ttf, etc.)
- **Image assets** — Preview images and other assets

Theme bundles require no build tools, npm packages, or JavaScript code -- they are purely declarative, containing only static assets and configuration.

#### Installing a Theme Bundle

1. Open **Settings** from the sidebar
2. Go to the **Appearance** tab
3. Click the **Install Theme** button
4. Select a `.qtap-theme` file from your computer
5. The theme appears in your theme list immediately

A bundle's manifest may name its styles, tokens, preview image, fonts and icons only by relative paths that stay inside the bundle. A registry that publishes a signing key has its index and signed bundles verified, and an install whose signature does not check out is refused. Installing a theme by URL, like importing an image by URL, fetches only from public http(s) addresses and within sensible size limits. A bundle tailored for an earlier Quilltap is turned away at the door, with the same explanation the Appearance card gives, before anything is written; a registry theme that declares itself of an earlier format is simply not offered.

#### Uninstalling a Theme Bundle

Bundle themes can be uninstalled from the Appearance settings:

1. Find the bundle theme in your theme list (marked with a "Bundle" badge)
2. Click its **Preview** button to open the preview window
3. Click the trash icon to uninstall
4. The theme is removed from your system

Note: The built-in default theme cannot be uninstalled. A bundle made for an earlier Quilltap is uninstalled from the **Garments Left at the Door** list instead.

#### Exporting a Theme

Any bundle theme on the shelf can be exported as a `.qtap-theme` bundle, exactly as it was installed (the built-in default, having no bundle of its own, cannot):

1. Find the theme in your theme list
2. Click its **Preview** button to open the preview window
3. Click the download/export icon
4. Save the `.qtap-theme` file to your computer
5. Share it with others or use it as a starting point for a new theme

## Color Modes

In addition to choosing a theme, you can select your preferred **color mode**:

### Light Mode

- Bright background with dark text
- Better for well-lit environments
- Reduces eye strain in daylight
- Use when you prefer a clean, bright interface

### Dark Mode

- Dark background with light text
- Better for low-light environments
- Reduces blue light exposure
- Use when you prefer a darker interface for evening work

### System Mode

- Automatically matches your operating system preference
- Switches when your OS switches between light and dark
- No manual switching needed
- Recommended for most users

## Changing Your Theme

### Quick Theme Switcher

The theme quick-switcher is a convenient way to change themes from the sidebar:

1. Look at the **sidebar footer** (bottom left of the screen)
2. Find the **palette icon** (paintbrush/colors)
3. Click to open the theme menu
4. Select a theme from the list
5. Your theme changes instantly

The quick-switcher only appears if you've enabled it in Settings (see below).

### Through Settings

You can also change themes in the Appearance settings:

1. Open **Settings** from the sidebar
2. Go to the **Appearance** tab
3. In the **Theme Selection** section, choose your preferred theme
4. See a preview of the selected theme
5. Changes apply immediately

### Through the Menu

When the quick-switcher is enabled:

1. Click the palette icon in the sidebar footer
2. See all available themes with color previews
3. Click any theme to switch
4. See color mode options below the themes
5. Click to change light/dark/system preference

## Theme Quick-Switcher Feature

The theme quick-switcher is an optional sidebar button that gives you instant access to theme and color mode selection.

### Enabling the Quick-Switcher

1. Open **Settings** from the sidebar
2. Go to the **Appearance** tab
3. Find the **Show theme selector in navigation** toggle
4. Turn it **ON**
5. The palette icon appears in the sidebar footer

### Disabling the Quick-Switcher

1. Open **Settings** → **Appearance**
2. Find the **Show theme selector in navigation** toggle
3. Turn it **OFF**
4. The palette icon disappears from the sidebar

### Using the Quick-Switcher

When enabled:

1. **Locate the icon** — Look for the palette (paintbrush/colors) icon in the sidebar footer
2. **Click to open** — Click the icon to open the theme menu
3. **Select a theme** — Click any theme name to switch instantly
4. **See colors** — Each theme shows color swatches for preview
5. **Change color mode** — Below themes, toggle between Light, Dark, and System modes
6. **Close menu** — Click elsewhere or press Escape to close

### Theme Quick-Switcher Features

- **Color previews** — See the theme's primary colors before switching
- **Font preview** — Theme names display in the theme's heading font
- **Current theme indicator** — The active theme shows a checkmark
- **Color mode options** — Quick access to light/dark/system modes
- **Instant switching** — Changes apply immediately
- **Mobile friendly** — Works on all screen sizes
- **Collapsible sidebar** — Icon-only view in collapsed sidebar mode

## Understanding Your Theme

### Color Scheme

Each theme includes colors for:

- **Background** — The main background color for pages and components
- **Foreground** — Text and primary content color
- **Primary** — Accent color for important UI elements, buttons, links, and the filled portion of sliders
- **Secondary** — Additional accent color for supporting elements
- **Accent** — Highlight color for special elements
- **Muted** — Subtle colors for borders, dividers, and less important content
- **Destructive** — Warning/danger color for actions like delete
- **Success, Warning, Info** — Semantic colors for feedback messages

### Light and Dark Mode Support

Themes provide colors for both modes:

- **Light mode colors** — Optimized for bright backgrounds
- **Dark mode colors** — Optimized for dark backgrounds

When you switch your color mode, the same theme's colors for that mode apply automatically.

### Legibility under every lamp

Every bundled theme is held to the same standard of legibility (WCAG 2.2 AA) in
each of its modes: ordinary text stands at least 4.5 times brighter (or darker)
than whatever it sits upon, and a focus ring at least three times. Where a theme
paints a row in its **Accent** colour on hover — a settings toggle, a storyteller
mode, a dialog's close cross — the words upon it change to the accent's own
partner colour, so a gilded Art Deco or Great Estate highlight never swallows
the label it is meant to flatter. Secondary text inside a notice (a warning, an
error, a bit of good news) takes the notice's own colour, and any link within it
is underlined rather than left to be told apart by hue alone.

The little coloured labels that festoon the place — a character's badge, a tag,
a memory, a "related" or "manual" marker, the success and warning pills in the
Scriptorium — are inked a shade deeper in light mode (and a shade brighter in
dark) than they once were, so each reads at that same 4.5 against its card.
A switch that stands **off** now wears a fine outline round its track, rather
than fading into the card like a ghost at a séance, and the theme cards on this
very page pick a dark or a light hand for their lettering by which of the two
actually stands out, not by guesswork.

Should the window be drawn very narrow, or the text enlarged to twice its size,
the formatting toolbar and the buttons along a character's header fold onto a
second line rather than slipping off the edge.

### Typography

Themes specify:

- **Heading font** — For titles and section headers
- **Body font** — For regular text and content
- **Monospace font** — For code and technical text

Custom fonts are loaded automatically when you select a theme.

## Managing Themes in Settings

### Appearance Settings

The **Appearance** group in Settings gives you full control:

- **Theme Selection** — Choose from the default, the bundled themes and any you have installed
- **Garments Left at the Door** — Themes made for an earlier Quilltap, with an explanation and, for bundles, an Uninstall button
- **Theme Preview** — See how each theme looks
- **Color Mode** — Light, Dark, or System preference
- **Quick-Switcher Toggle** — Enable/disable the sidebar quick-switcher

### Theme Details

For each theme, you can see:

- **Theme name** — The display name of the theme
- **Description** — What makes this theme unique
- **Color preview** — Sample colors in the theme's palette
- **Dark mode support** — Whether the theme supports dark mode
- **Active indicator** — Shows which theme is currently active

### Previewing a Theme

Every theme on the shelf wears a small **Preview** button, and pressing it throws open a full-page viewing window — a proper showroom rather than a keyhole. Within, you will find:

- **A banner in the theme's own livery** — the theme's background color, with the lettering automatically set to whichever shade (ivory or ink) reads most legibly against it. No more squinting at pale text on a brilliant ground.
- **A Light / Dark switch** — flip between the two to see how the theme comports itself in either light. (Themes that keep no evening wardrobe show only the Light setting.)
- **A live sampler** — genuine headings, buttons, inputs, badges, and a card, all dressed in the theme's colors and fonts, so you may judge the cut before committing.
- **A gallery of the theme's bundled images** — any preview image and the backdrops it hangs in Quilltap's principal halls, arranged alphabetically over a faint checkerboard so transparent artwork reads clearly. A theme that bundles no imagery simply says so.
- **A sheet of the theme's re-cut icons** — should the theme replace any of Quilltap's standard glyphs, each appears here in four guises (ordinary, muted, hovered, and set upon a colored button), with its name printed beneath in plain type for easy copying. A theme that leaves the icons alone says as much.

From the banner you may **Apply** the theme outright, **Export** it as a `.qtap-theme` bundle, or — for bundle themes not presently in use — **Uninstall** it. Close the window by the **×**, the Escape key, or a click upon the surrounding gloom; nothing is committed until you press **Apply**.

## Color Modes Explained

### System Mode (Recommended)

- **What it does** — Follows your computer's light/dark preference
- **When to use** — Most of the time; best for automatic consistency
- **How it works** — Quilltap detects your OS preference and switches automatically
- **Mobile** — Most phones default to light mode during day, dark at night

### Light Mode

- **When to use** — During daytime or in well-lit environments
- **Advantages** — Bright, clear interface; reduced eye strain in daylight
- **Note** — May cause glare on dark screens or in dim lighting

### Dark Mode

- **When to use** — At night or in low-light environments
- **Advantages** — Reduced blue light; comfortable for evening use
- **Note** — Some users prefer it all the time for comfort

## Custom Themes

### Installing Theme Bundles

The simplest way to install a custom theme:

1. Obtain a `.qtap-theme` file
2. Open **Settings** > **Appearance**
3. Click **Install Theme** and select the file
4. The theme is instantly available

### Creating Your Own Theme

The gentlest way in is [Calliope's Atelier](theme-editor.md) (**Settings → Appearance → Design a theme**): start from a blank canvas or a copy of any theme you have, choose its colours while the whole of Quilltap wears the result, and install it with a press of a button. For everything the Atelier does not yet edit, or if you prefer a text editor, themes are made by hand in the `.qtap-theme` bundle format:

```bash
npx create-quilltap-theme my-theme
```

This scaffolds a directory holding `theme.json` (the particulars of the thing), `tokens.json` (its palette, its type and its proportions) and `styles.css` (for the flourishes no token covers), together with a short README — no build tools, no npm packages, no TypeScript. Both JSON files name their published schema, so any editor of modern habits will complete and correct each field as you type. Edit to taste, check your work with `npx quilltap themes validate ./my-theme`, then zip and install.

A theme states only what it changes; everything it leaves unsaid keeps the house default. Your stylesheet is written without the theme's name — Quilltap confines every rule to your theme when it loads it — and it should address the hooks the house publishes for the purpose rather than whatever happens to be lying about in the markup, for the latter is apt to be moved without notice. The validator will point out, by file and line, any rule that has strayed. The full authoring guide, the catalogue of tokens and the catalogue of hooks are kept in the developer documentation as `THEME_DEVELOPMENT.md`, `THEME_TOKENS.md` and `THEME_HOOKS.md`.

### Custom Icons

Beyond the customary palette and typography, `.qtap-theme` bundles may declare their own icon artwork — replacing any of the application's eighty standard glyphs with designs of the author's own devising. When the theme is active, the substitution is instantaneous and entirely silent: no reload, no ceremony, simply a different glyph appearing in the expected place.

For a demonstration of the form taken to its logical conclusion, activate the bundled **Madman's Box** theme: every last glyph in the house has been re-cut to its specifications — brass clockwork, sharp corners, and not a rounded cap in sight.

#### Declaring Icon Overrides

In your `theme.json`, add an `icons` record mapping each icon's name to a bundle-relative asset path:

```json
{
  "icons": {
    "brand":    "icons/brand.webp",
    "settings": "icons/settings.svg",
    "wardrobe": "icons/wardrobe.svg",
    "help":     "icons/help.svg"
  }
}
```

Names must correspond to entries in Quilltap's canonical icon list — the complete catalogue appears in the **Icons** story of `@quilltap/theme-storybook`, and in the developer documentation's `ICON_INVENTORY.md`. Icons not declared in the map are left at their defaults; the entire list need not be addressed, only those whose default glyph the theme wishes to improve upon.

#### Two Modes of Replacement

The file format governs how the replacement is rendered:

- **`.svg` files** are painted in *mask mode*: the glyph is tinted by the surrounding text colour (`currentColor`). Ideal for clean monochrome line drawings that should harmonise with the theme's foreground, active, or muted states — the icon responds to hover and disabled colouring exactly as a stock glyph would. Passing splendidly in polite society, one might say.
- **`.webp` files** (and other non-SVG formats) are displayed in *image mode*: the artwork is shown exactly as authored, colours unchanged by the interface. Well-suited to icons that carry their own palette — a brass-inlaid quill, a hand-lettered monogram, or an illustration that must retain its specific hue regardless of what the surrounding typography is doing.

The `brand` icon obeys the same rule as the rest of the company: an `.svg` brand mark is tinted along with everything else, while a `.webp` brand mark keeps its own colours. Should your masthead insist upon arriving in full regalia — gilt, enamel, and all — supply it as `.webp`; supply it as `.svg` and it will dress to match the room.

#### Validating Icon Overrides

The `npx quilltap themes validate` command checks the `icons` block as part of its inspection — it confirms that every name is one of Quilltap's own icons, that every asset ends in `.svg` or `.webp`, and that every path stays politely inside the bundle. A name the house does not recognise is an error, not a shrug, so a misspelt glyph is caught before it can sulk unseen.

### Page Backgrounds

Each of Quilltap's principal halls keeps a faint backdrop behind its furniture — Aurora has its portrait gallery, the Salon its parlour, the Scriptorium its stacks, and so on, with the Settings page changing its scene to suit whichever group is presently in hand. Like the icons, these backdrops are yours to redress. A theme may hang its own painting in any of these rooms, or strip the walls bare entirely, and the swap is as silent and immediate as the rest.

#### Declaring Background Overrides

In your `theme.json`, add a `subsystems` record. Each key names a Quilltap subsystem; each value supplies a `backgroundImage` pointing at a bundle-relative asset:

```json
{
  "subsystems": {
    "aurora":           { "backgroundImage": "textures/aurora-bg.webp" },
    "prospero":         { "backgroundImage": "textures/prospero-bg.webp" },
    "salon":            { "backgroundImage": "textures/salon-bg.webp" },
    "commonplace-book": { "backgroundImage": "textures/commonplace-book-bg.webp" },
    "scriptorium":      { "backgroundImage": "textures/scriptorium-bg.webp" },
    "lantern":          { "backgroundImage": "textures/lantern-bg.webp" }
  }
}
```

The subsystem keys are Quilltap's own — `aurora` (Characters), `prospero` (Projects), `salon` (Chats), `commonplace-book` (Files; note the hyphen), `scriptorium` (Document Stores), and `lantern` (Photos), among others. Only the rooms you name are re-papered; any subsystem left unmentioned keeps the house default, so a theme need address only those backdrops it wishes to improve upon.

Paths are bundle-relative (`textures/…`) and resolve to the theme's own assets exactly as icon paths do; a theme may not send out for its pictures, so a rooted `/path` or an `http(s)://` address is refused. The art is painted at a polite low opacity behind the page's contents, so a sympathetic, unhurried image serves best.

#### Suppressing a Background

To leave a particular room's walls bare — no backdrop at all — set the value to the sentinel `"none"`:

```json
"subsystems": {
  "salon": { "backgroundImage": "none" }
}
```

Quilltap then renders that page with no story background whatsoever, rather than falling through to the stock image.

For a worked example, activate the bundled **Madman's Box** theme, which dresses its principal halls in walnut and brass to match the rest of its furnishings.

### Managing Themes via CLI

The `quilltap themes` CLI provides commands for managing theme bundles from the terminal:

```bash
# List all installed themes
npx quilltap themes list

# Validate a .qtap-theme file (or a bundle directory) before installing
npx quilltap themes validate my-theme.qtap-theme
npx quilltap themes validate ./my-theme

# Install a .qtap-theme bundle
npx quilltap themes install my-theme.qtap-theme

# Install from a URL
npx quilltap themes install https://example.com/my-theme.qtap-theme

# Uninstall a bundle theme
npx quilltap themes uninstall my-theme

# Export any theme as a .qtap-theme file
npx quilltap themes export earl-grey --output ./my-export.qtap-theme

# Scaffold a new theme (delegates to create-quilltap-theme)
npx quilltap themes create sunset
```

The `validate` command runs the very inspection the application itself performs — structure, file types, size limits, the manifest, every token and value, and the stylesheet — without installing anything. It reports, with file and line, whatever an install would refuse and whatever merely deserves a raised eyebrow. A bundle made for an earlier Quilltap is turned away here as it would be at the door. Use it before distributing your work.

### Theme Registries

Theme registries are remote indexes of themes that you can browse, search, and install from. Think of them as curated theme catalogs.

#### Browsing Themes in the UI

1. Open **Settings** > **Appearance**
2. Scroll down to the **Browse Themes** section
3. Search for themes by name, tag, or description
4. Click **Install** on any theme to download and install it
5. Verified themes show a checkmark badge (signature verified against the registry's public key)

#### Managing Registries via CLI

```bash
# List configured registries
npx quilltap themes registry list

# Add a registry source
npx quilltap themes registry add https://example.com/registry.json --name "My Registry"

# Add a registry with signature verification
npx quilltap themes registry add https://example.com/registry.json --key ed25519:BASE64KEY

# Remove a registry
npx quilltap themes registry remove "My Registry"

# Refresh all registry indexes
npx quilltap themes registry refresh

# Search for themes across registries
npx quilltap themes search "dark modern"

# Check for theme updates
npx quilltap themes update

# Update a specific theme
npx quilltap themes update my-theme
```

#### For Registry Operators

If you host your own theme registry, the CLI provides tools for signing:

```bash
# Generate an Ed25519 keypair
npx quilltap themes registry keygen --output ./keys

# Sign a registry directory
npx quilltap themes registry sign ./my-registry --key ed25519:PRIVATE_KEY
```

Registry indexes are JSON files listing available themes with download URLs, SHA-256 hashes, and optional Ed25519 signatures for integrity verification.

## Tips for Theme Selection

1. **Try different themes** — Spend time with each to find your favorite
2. **Consider color mode** — Choose light for daytime, dark for evening, system for automatic
3. **Test readability** — Make sure text is easy to read in your preferred theme
4. **Match your workflow** — Some themes may feel better for different types of work
5. **Use quick-switcher** — Enable it if you like switching themes frequently
6. **Adjust sidebar width** — Combined with theme changes, this can transform your interface

## Theme Persistence

Your theme choices are saved automatically:

- **Theme preference** — Your selected theme is remembered
- **Color mode preference** — Light/dark/system choice is saved
- **Quick-switcher setting** — Whether it's enabled is remembered
- **Cross-device** — Preferences sync across devices when logged in

Every time you log in, Quilltap remembers your theme selections.

## Troubleshooting Themes

### Theme Not Appearing

- Look under **Garments Left at the Door** on the Appearance card: a theme made for an earlier Quilltap, or supplied by a plugin, is listed there rather than on the shelf
- If it was a bundle you installed, try installing it again; a failed install says why
- Try refreshing the browser

### My Theme Changed Back to the Default

- The theme you had chosen can no longer be worn — it was made for an earlier Quilltap, or it has been uninstalled
- Quilltap says so once, then wears the Default theme until you choose another
- See [Themes Tailored for an Earlier Quilltap](#themes-tailored-for-an-earlier-quilltap) above

### Colors Look Wrong

- Check your color mode (light/dark/system)
- Verify you've selected the theme you want
- Try switching to system mode
- Check if a browser extension is interfering

### Fonts Look Different

- Custom fonts take a moment to load
- If fonts don't appear, the fallback font is used
- Refresh if needed
- Check your browser's font rendering settings

### Theme Doesn't Save

- Check your internet connection
- Verify you're logged in
- Try switching themes again
- Check the browser console for errors

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?section=appearance")`

Themes are a powerful way to personalize Quilltap and make it work for your creative style and environment!
