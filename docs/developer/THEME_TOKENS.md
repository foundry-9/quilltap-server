# Theme tokens

<!-- GENERATED FILE — DO NOT EDIT BY HAND. Source: lib/themes/registry/. Regenerate with `npm run generate:theme-tokens-doc`. -->

Every token a theme's `tokens.json` may set — 712 tokens in 50 groups. A theme stores only what it changes: a value for both modes, or `{ "value": …, "dark": … }`. Defaults may reference other tokens with `var()`. The registry lives in `lib/themes/registry/`; the authoring guide is [THEME_DEVELOPMENT.md](THEME_DEVELOPMENT.md) and the structural hooks are in [THEME_HOOKS.md](THEME_HOOKS.md).

**Visibility:** `standard` tokens are the ones themes set often; `advanced` ones rarely; `internal` ones are app plumbing a theme should leave alone.

## Choices

A choice is set in `tokens.json` under `choices`, e.g. `"choices": { "density": "comfortable" }`. Tokens that vary with a choice list their non-default values under "By choice".

| Choice | Options | Default | What it is |
| --- | --- | --- | --- |
| `density` | `compact`, `comfortable` | `compact` | Density. How roomy the interface is: padding, avatar and control sizes, and sidebar and header dimensions. Compact is the default theme; comfortable is what every bundled theme has used. |

## Colours

Group id `colors`, 27 tokens.

The semantic colour pairs every component derives from: surfaces, text, actions, status, borders. Each X has an X-foreground meant to read on it. Tailwind maps each to a --color-* utility (app/styles/theme-tokens.css).

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-background` | color | `hsl(225 14% 97%)` | `hsl(225 18% 9%)` |  | standard | Background. Page background - cool off-white |
| `--theme-card` | color | `hsl(0 0% 100%)` | `hsl(225 16% 12%)` |  | standard | Card. Card/surface background - pure white, lifted from page |
| `--theme-card-foreground` | color | `hsl(225 18% 13%)` | `hsl(225 10% 92%)` |  | standard | Card foreground |
| `--theme-popover` | color | `hsl(0 0% 100%)` | `hsl(225 16% 14%)` |  | standard | Popover. Popover/dropdown - same as card, shadow provides elevation |
| `--theme-popover-foreground` | color | `hsl(225 18% 13%)` | `hsl(225 10% 92%)` |  | standard | Popover foreground |
| `--theme-foreground` | color | `hsl(225 18% 13%)` | `hsl(225 10% 92%)` |  | standard | Foreground. Text - not pure black, slightly cool |
| `--theme-primary` | color | `hsl(225 65% 48%)` | `hsl(225 55% 68%)` |  | standard | Primary. Primary action - confident indigo-blue |
| `--theme-primary-foreground` | color | `hsl(0 0% 100%)` | `hsl(225 18% 9%)` |  | standard | Primary foreground |
| `--theme-secondary` | color | `hsl(225 10% 92%)` | `hsl(225 14% 17%)` |  | standard | Secondary. Secondary action - subtle cool-gray tint |
| `--theme-secondary-foreground` | color | `hsl(225 18% 22%)` | `hsl(225 10% 85%)` |  | standard | Secondary foreground |
| `--theme-muted` | color | `hsl(225 10% 94%)` | `hsl(225 12% 14%)` |  | standard | Muted. Muted - de-emphasized content |
| `--theme-muted-foreground` | color | `hsl(225 8% 42%)` | `hsl(225 8% 58%)` |  | standard | Muted foreground |
| `--theme-accent` | color | `hsl(225 10% 93%)` | `hsl(225 14% 18%)` |  | standard | Accent. Accent - neutral, same personality as secondary |
| `--theme-accent-foreground` | color | `hsl(225 18% 22%)` | `hsl(225 10% 85%)` |  | standard | Accent foreground |
| `--theme-destructive` | color | `hsl(0 68% 50%)` | `hsl(0 60% 62%)` |  | standard | Destructive. Semantic colors |
| `--theme-destructive-foreground` | color | `hsl(0 0% 100%)` | `hsl(225 18% 9%)` |  | standard | Destructive foreground |
| `--theme-success` | color | `hsl(152 60% 31%)` | `hsl(152 55% 44%)` |  | standard | Success |
| `--theme-success-foreground` | color | `hsl(0 0% 100%)` | `hsl(225 18% 9%)` |  | standard | Success foreground |
| `--theme-warning` | color | `hsl(38 90% 32%)` | `hsl(38 85% 52%)` |  | standard | Warning |
| `--theme-warning-foreground` | color | `hsl(0 0% 100%)` | `hsl(0 0% 10%)` |  | standard | Warning foreground |
| `--theme-info` | color | `hsl(210 75% 44.5%)` | `hsl(210 70% 58%)` |  | standard | Info |
| `--theme-info-foreground` | color | `hsl(0 0% 100%)` | `hsl(225 18% 9%)` |  | standard | Info foreground |
| `--theme-border` | color | `hsl(225 10% 87%)` | `hsl(225 12% 20%)` |  | standard | Border. Borders & inputs |
| `--theme-input` | color | `hsl(225 10% 57.5%)` | `hsl(225 12% 43.5%)` |  | standard | Input |
| `--theme-ring` | color | `hsl(225 65% 48%)` | `hsl(225 55% 60%)` |  | standard | Ring |
| `--theme-chat-user` | color | `hsl(225 62% 50%)` | `hsl(225 60% 56%)` |  | standard | Chat user. Chat - user bubble matches primary hue |
| `--theme-chat-user-foreground` | color | `hsl(0 0% 100%)` |  |  | standard | Chat user foreground |

## Sidebar colours

Group id `sidebar-colors`, 6 tokens.

The navigation sidebar's own palette, mapped to --color-sidebar-* utilities.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-sidebar-background` | color | `hsl(225 14% 95%)` | `hsl(225 18% 7%)` |  | standard | Sidebar background. Sidebar |
| `--theme-sidebar-foreground` | color | `hsl(225 18% 18%)` | `hsl(225 10% 88%)` |  | standard | Sidebar foreground |
| `--theme-sidebar-border` | color | `hsl(225 10% 87%)` | `hsl(225 12% 16%)` |  | standard | Sidebar border |
| `--theme-sidebar-muted` | color | `hsl(225 8% 44.5%)` | `hsl(225 8% 51%)` |  | standard | Sidebar muted |
| `--theme-sidebar-accent` | color | `hsl(225 10% 93%)` | `hsl(225 14% 18%)` |  | standard | Sidebar accent |
| `--theme-sidebar-accent-foreground` | color | `hsl(225 18% 22%)` | `hsl(225 10% 85%)` |  | standard | Sidebar accent foreground |

## Corner radii

Group id `radius`, 5 tokens.

The radius scale. Tailwind maps sm / md / lg to --radius-*; components read those.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-radius-lg` | radius | `0.5rem` |  |  | standard | Radius large. Radii - tighter for a precise look |
| `--theme-radius-md` | radius | `0.375rem` |  |  | standard | Radius medium |
| `--theme-radius-sm` | radius | `0.25rem` |  |  | standard | Radius small |
| `--theme-radius-xl` | radius | `0.625rem` |  |  | internal | Radius extra large. A theme may set it; nothing in the app reads it yet. |
| `--theme-radius-full` | radius | `9999px` |  |  | internal | Radius full. A theme may set it; nothing in the app reads it yet. |

## Type scale

Group id `type-scale`, 18 tokens.

Font sizes, line heights, weights and letter spacing.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-font-size-xs` | length | `0.75rem` |  |  | internal | Font size extra small. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-size-sm` | length | `0.875rem` |  |  | internal | Font size small. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-size-base` | length | `1rem` |  |  | internal | Font size base. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-size-lg` | length | `1.125rem` |  |  | internal | Font size large. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-size-xl` | length | `1.25rem` |  |  | internal | Font size extra large. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-size-2xl` | length | `1.5rem` |  |  | internal | Font size 2× large. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-size-3xl` | length | `1.875rem` |  |  | internal | Font size 3× large. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-size-4xl` | length | `2.25rem` |  |  | internal | Font size 4× large. A theme may set it; nothing in the app reads it yet. |
| `--theme-line-height-tight` | number | `1.25` |  |  | internal | Line height tight. A theme may set it; nothing in the app reads it yet. |
| `--theme-line-height-normal` | number | `1.5` |  |  | internal | Line height normal. A theme may set it; nothing in the app reads it yet. |
| `--theme-line-height-relaxed` | number | `1.75` |  |  | internal | Line height relaxed. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-weight-normal` | font-weight | `400` |  |  | internal | Font weight normal. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-weight-medium` | font-weight | `500` |  |  | internal | Font weight medium. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-weight-semibold` | font-weight | `600` |  |  | internal | Font weight semibold. A theme may set it; nothing in the app reads it yet. |
| `--theme-font-weight-bold` | font-weight | `700` |  |  | internal | Font weight bold. A theme may set it; nothing in the app reads it yet. |
| `--theme-letter-spacing-tight` | length | `-0.025em` |  |  | internal | Letter spacing tight. A theme may set it; nothing in the app reads it yet. |
| `--theme-letter-spacing-normal` | length | `0` |  |  | internal | Letter spacing normal. A theme may set it; nothing in the app reads it yet. |
| `--theme-letter-spacing-wide` | length | `0.025em` |  |  | internal | Letter spacing wide. A theme may set it; nothing in the app reads it yet. |

## Spacing scale

Group id `spacing`, 10 tokens.

The spacing steps.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-spacing-1` | length | `0.25rem` |  |  | internal | Spacing 1. A theme may set it; nothing in the app reads it yet. |
| `--theme-spacing-2` | length | `0.5rem` |  |  | internal | Spacing 2. A theme may set it; nothing in the app reads it yet. |
| `--theme-spacing-3` | length | `0.75rem` |  |  | internal | Spacing 3. A theme may set it; nothing in the app reads it yet. |
| `--theme-spacing-4` | length | `1rem` |  |  | internal | Spacing 4. A theme may set it; nothing in the app reads it yet. |
| `--theme-spacing-5` | length | `1.25rem` |  |  | internal | Spacing 5. A theme may set it; nothing in the app reads it yet. |
| `--theme-spacing-6` | length | `1.5rem` |  |  | internal | Spacing 6. A theme may set it; nothing in the app reads it yet. |
| `--theme-spacing-8` | length | `2rem` |  |  | internal | Spacing 8. A theme may set it; nothing in the app reads it yet. |
| `--theme-spacing-10` | length | `2.5rem` |  |  | internal | Spacing 10. A theme may set it; nothing in the app reads it yet. |
| `--theme-spacing-12` | length | `3rem` |  |  | internal | Spacing 12. A theme may set it; nothing in the app reads it yet. |
| `--theme-spacing-16` | length | `4rem` |  |  | internal | Spacing 16. A theme may set it; nothing in the app reads it yet. |

## Effects

Group id `effects`, 10 tokens.

Shadows, transition timing and the focus ring.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-shadow-sm` | shadow | `0 1px 2px 0 rgb(0 0 0 / 0.05)` |  |  | internal | Shadow small. A theme may set it; nothing in the app reads it yet. |
| `--theme-shadow-md` | shadow | `0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)` |  |  | internal | Shadow medium. A theme may set it; nothing in the app reads it yet. |
| `--theme-shadow-lg` | shadow | `0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)` |  |  | internal | Shadow large. A theme may set it; nothing in the app reads it yet. |
| `--theme-shadow-xl` | shadow | `0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.04)` |  |  | internal | Shadow extra large. A theme may set it; nothing in the app reads it yet. |
| `--theme-transition-fast` | duration | `150ms` |  |  | internal | Transition fast. A theme may set it; nothing in the app reads it yet. |
| `--theme-transition-normal` | duration | `200ms` |  |  | internal | Transition normal. A theme may set it; nothing in the app reads it yet. |
| `--theme-transition-slow` | duration | `300ms` |  |  | internal | Transition slow. A theme may set it; nothing in the app reads it yet. |
| `--theme-transition-easing` | easing | `cubic-bezier(0.4, 0, 0.2, 1)` |  |  | internal | Transition easing. A theme may set it; nothing in the app reads it yet. |
| `--theme-focus-ring-width` | length | `2px` |  |  | standard | Focus ring width. Read by the app's :focus-visible ring (_base.css), for a theme that turns it on (data-qt-focus-ring). |
| `--theme-focus-ring-offset` | length | `2px` |  |  | standard | Focus ring offset. Read by the app's :focus-visible ring (_base.css), for a theme that turns it on (data-qt-focus-ring). |

## Category palette

Group id `category`, 35 tokens.

One colour per category of thing a badge labels, with the text colour that reads on its tint. Badge backgrounds are the category colour at the tint strength; badge text is the category foreground.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-category-tint` | opacity | `12%` | `25%` |  | standard | Category badge tint strength. How strongly a category colour fills its badge background (the colour mixed with transparent at this share). |
| `--theme-category-character` | color | `hsl(225 55% 55%)` | `hsl(225 55% 58%)` |  | standard | Characters |
| `--theme-category-character-foreground` | color | `hsl(225 55% 42%)` | `hsl(225 55% 72%)` |  | standard | Characters — text |
| `--theme-category-user-character` | color | `hsl(270 45% 55%)` | `hsl(270 45% 58%)` |  | standard | Your characters (and manual / bundled-plugin badges, which every theme colours alike) |
| `--theme-category-user-character-foreground` | color | `hsl(270 45% 42%)` | `hsl(270 45% 72%)` |  | standard | Your characters (and manual / bundled-plugin badges, which every theme colours alike) — text |
| `--theme-category-chat` | color | `hsl(152 50% 38%)` | `hsl(152 50% 40%)` |  | standard | Chats (and the enabled badge, which every theme colours alike) |
| `--theme-category-chat-foreground` | color | `hsl(152 50% 30%)` | `hsl(152 50% 62%)` |  | standard | Chats (and the enabled badge, which every theme colours alike) — text |
| `--theme-category-tag` | color | `hsl(25 70% 48%)` | `hsl(25 70% 50%)` |  | standard | Tags |
| `--theme-category-tag-foreground` | color | `hsl(25 70% 36.5%)` | `hsl(25 70% 62%)` |  | standard | Tags — text |
| `--theme-category-memory` | color | `hsl(330 55% 52%)` | `hsl(330 55% 55%)` |  | standard | Memories |
| `--theme-category-memory-foreground` | color | `hsl(330 55% 38%)` | `hsl(330 55% 68%)` |  | standard | Memories — text |
| `--theme-category-message` | color | `hsl(45 70% 48%)` | `hsl(45 70% 50%)` |  | standard | Messages |
| `--theme-category-message-foreground` | color | `hsl(45 70% 29.5%)` | `hsl(45 70% 68%)` |  | standard | Messages — text |
| `--theme-category-project` | color | `hsl(185 55% 38%)` |  |  | standard | Projects |
| `--theme-category-project-foreground` | color | `hsl(185 55% 30%)` | `hsl(185 55% 68%)` |  | standard | Projects — text |
| `--theme-category-related` | color | `hsl(270 45% 55%)` | `hsl(270 45% 58%)` |  | standard | Related items |
| `--theme-category-related-foreground` | color | `hsl(270 45% 42%)` | `hsl(270 45% 72%)` |  | standard | Related items — text |
| `--theme-category-source-npm` | color | `hsl(0 60% 50%)` | `hsl(0 60% 55%)` |  | standard | npm plugin source |
| `--theme-category-source-npm-foreground` | color | `hsl(0 60% 38%)` | `hsl(0 60% 68%)` |  | standard | npm plugin source — text |
| `--theme-category-source-git` | color | `hsl(25 70% 48%)` | `hsl(25 70% 50%)` |  | standard | git plugin source |
| `--theme-category-source-git-foreground` | color | `hsl(25 70% 36.5%)` | `hsl(25 70% 62%)` |  | standard | git plugin source — text |
| `--theme-category-wardrobe-top` | color | `hsl(220 60% 55%)` | `hsl(220 60% 58%)` |  | standard | Wardrobe slot: top |
| `--theme-category-wardrobe-top-foreground` | color | `hsl(220 60% 42%)` | `hsl(220 60% 72%)` |  | standard | Wardrobe slot: top — text |
| `--theme-category-wardrobe-bottom` | color | `hsl(152 50% 38%)` | `hsl(152 50% 40%)` |  | standard | Wardrobe slot: bottom |
| `--theme-category-wardrobe-bottom-foreground` | color | `hsl(152 50% 30%)` | `hsl(152 50% 62%)` |  | standard | Wardrobe slot: bottom — text |
| `--theme-category-wardrobe-footwear` | color | `hsl(38 70% 48%)` | `hsl(38 70% 50%)` |  | standard | Wardrobe slot: footwear |
| `--theme-category-wardrobe-footwear-foreground` | color | `hsl(38 70% 32%)` | `hsl(38 70% 68%)` |  | standard | Wardrobe slot: footwear — text |
| `--theme-category-wardrobe-accessories` | color | `hsl(270 45% 55%)` | `hsl(270 45% 58%)` |  | standard | Wardrobe slot: accessories |
| `--theme-category-wardrobe-accessories-foreground` | color | `hsl(270 45% 42%)` | `hsl(270 45% 72%)` |  | standard | Wardrobe slot: accessories — text |
| `--theme-category-wardrobe-hair` | color | `hsl(345 55% 55%)` | `hsl(345 55% 58%)` |  | standard | Wardrobe slot: hair |
| `--theme-category-wardrobe-hair-foreground` | color | `hsl(345 55% 42%)` | `hsl(345 55% 72%)` |  | standard | Wardrobe slot: hair — text |
| `--theme-category-wardrobe-shared` | color | `hsl(240 50% 55%)` | `hsl(240 50% 58%)` |  | standard | Wardrobe: shared items |
| `--theme-category-wardrobe-shared-foreground` | color | `hsl(240 50% 42%)` | `hsl(240 50% 72%)` |  | standard | Wardrobe: shared items — text |
| `--theme-category-capability` | color | `hsl(225 55% 55%)` | `hsl(225 55% 58%)` |  | standard | Model capability |
| `--theme-category-capability-foreground` | color | `hsl(225 55% 42%)` | `hsl(225 55% 72%)` |  | standard | Model capability — text |

## Status palette

Group id `status-palette`, 10 tokens.

The colours of alerts and notices: one colour per status, shown at a fill strength for the background and an edge strength for the border, with a text colour of its own. These are lighter than the action colours (--theme-success and friends), which buttons and solid status badges use.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-status-tint` | opacity | `8%` | `15%` |  | standard | Status fill strength. How strongly a status colour fills an alert background. |
| `--theme-status-edge` | opacity | `25%` | `40%` |  | standard | Status border strength. How strongly a status colour draws an alert border. |
| `--theme-status-success` | color | `hsl(152 60% 38%)` | `hsl(152 55% 38%)` |  | standard | Success alert colour |
| `--theme-status-success-foreground` | color | `hsl(152 60% 28%)` | `hsl(152 55% 62%)` |  | standard | Success alert text |
| `--theme-status-warning` | color | `hsl(38 90% 46%)` | `hsl(38 85% 50%)` |  | standard | Warning alert colour |
| `--theme-status-warning-foreground` | color | `hsl(38 90% 28%)` | `hsl(38 85% 68%)` |  | standard | Warning alert text |
| `--theme-status-danger` | color | `hsl(0 68% 50%)` | `hsl(0 60% 54%)` |  | standard | Danger alert colour |
| `--theme-status-danger-foreground` | color | `hsl(0 68% 35%)` | `hsl(0 60% 68%)` |  | standard | Danger alert text |
| `--theme-status-info` | color | `hsl(210 75% 48%)` | `hsl(210 70% 55%)` |  | standard | Info alert colour |
| `--theme-status-info-foreground` | color | `hsl(210 75% 30%)` | `hsl(210 70% 68%)` |  | standard | Info alert text |

## Chat surfaces

Group id `chat-surfaces`, 10 tokens.

The Salon's message surfaces. The user bubble is --theme-chat-user (Colours); the assistant surface and text are here, and each special message kind (whisper, silent, wardrobe notice) is the assistant surface mixed with that kind's accent, labelled in its foreground.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-chat-assistant` | color | `var(--theme-muted)` |  |  | standard | Assistant message surface |
| `--theme-chat-assistant-foreground` | color | `var(--theme-foreground)` |  |  | standard | Assistant message text |
| `--theme-chat-system` | color | `var(--theme-muted)` |  |  | standard | Staff (system) message accent. Mixed into the assistant surface for the one-line Staff bar. |
| `--theme-chat-system-foreground` | color | `var(--theme-muted-foreground)` |  |  | standard | Staff (system) message text |
| `--theme-chat-whisper` | color | `#9b8ec4` | `#6b5b95` |  | standard | Whisper accent. Mixed 40% into the assistant surface for the whisper bubble, and its border. |
| `--theme-chat-whisper-foreground` | color | `#5c447e` | `#b5a9d1` |  | standard | Whisper label |
| `--theme-chat-silent` | color | `#7a9e8e` | `#4a7a6a` |  | standard | Silent (inner) message accent. Mixed 35% into the assistant surface for the silent bubble, and its border. |
| `--theme-chat-silent-foreground` | color | `#445c51` | `#8ab8a4` |  | standard | Silent (inner) message label |
| `--theme-chat-wardrobe` | color | `#c4a24e` | `#8a6d1b` |  | standard | Wardrobe notice accent. Mixed 40% into the assistant surface for the wardrobe bubble, and its border. |
| `--theme-chat-wardrobe-foreground` | color | `#69551f` | `#d4b65c` |  | standard | Wardrobe notice label |

## Roleplay text

Group id `roleplay-text`, 16 tokens.

How a roleplay template's annotations look: dialogue, narration, inner monologue and out-of-character asides each have a surface and a text colour; the four template chips (qt-roleplay-1..4) have a colour and a foreground. The insert buttons (--qt-rp-button-*) stay component tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-roleplay-dialogue` | color | `transparent` |  |  | standard | Dialogue surface |
| `--theme-roleplay-dialogue-foreground` | color | `var(--theme-foreground)` |  |  | standard | Dialogue text |
| `--theme-roleplay-narration` | color | `hsl(225 14% 12% / 0.8)` |  |  | standard | Narration surface |
| `--theme-roleplay-narration-foreground` | color | `hsl(225 10% 72%)` |  |  | standard | Narration text |
| `--theme-roleplay-inner-monologue` | color | `hsl(270 20% 12% / 0.8)` |  |  | standard | Inner monologue surface |
| `--theme-roleplay-inner-monologue-foreground` | color | `hsl(270 50% 72%)` |  |  | standard | Inner monologue text |
| `--theme-roleplay-ooc` | color | `hsl(0 0% 6%)` |  |  | standard | Out-of-character aside surface |
| `--theme-roleplay-ooc-foreground` | color | `hsl(152 60% 58%)` |  |  | standard | Out-of-character aside text |
| `--theme-roleplay-chip-1` | color | `hsl(217 91% 53%)` | `hsl(217 91% 52.5%)` |  | standard | Template chip 1 |
| `--theme-roleplay-chip-1-foreground` | color | `hsl(0 0% 100%)` |  |  | standard | Template chip 1 text |
| `--theme-roleplay-chip-2` | color | `hsl(270 65% 55%)` | `hsl(270 70% 59.5%)` |  | standard | Template chip 2 |
| `--theme-roleplay-chip-2-foreground` | color | `hsl(0 0% 100%)` |  |  | standard | Template chip 2 text |
| `--theme-roleplay-chip-3` | color | `hsl(38 92% 50%)` | `hsl(38 95% 56%)` |  | standard | Template chip 3 |
| `--theme-roleplay-chip-3-foreground` | color | `hsl(30 45% 12%)` |  |  | standard | Template chip 3 text |
| `--theme-roleplay-chip-4` | color | `hsl(168 78% 29%)` | `hsl(168 70% 30%)` |  | standard | Template chip 4 |
| `--theme-roleplay-chip-4-foreground` | color | `hsl(0 0% 100%)` |  |  | standard | Template chip 4 text |

## Terminal palette

Group id `terminal-palette`, 20 tokens.

Ariel's terminal: background, text, cursor, selection and the sixteen ANSI colours. A terminal keeps its own identity whatever the theme's mode, so these have no dark values of their own.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-terminal-background` | color | `#1a1a1a` |  |  | standard | Terminal background |
| `--theme-terminal-foreground` | color | `#e6e6e6` |  |  | standard | Terminal text |
| `--theme-terminal-cursor` | color | `#e6e6e6` |  |  | standard | Terminal cursor |
| `--theme-terminal-selection` | color | `rgba(255, 255, 255, 0.2)` |  |  | standard | Terminal selection |
| `--theme-terminal-ansi-black` | color | `#000000` |  |  | standard | ANSI black |
| `--theme-terminal-ansi-bright-black` | color | `#666666` |  |  | standard | ANSI bright black |
| `--theme-terminal-ansi-red` | color | `#cd3131` |  |  | standard | ANSI red |
| `--theme-terminal-ansi-bright-red` | color | `#f14c4c` |  |  | standard | ANSI bright red |
| `--theme-terminal-ansi-green` | color | `#0dbc79` |  |  | standard | ANSI green |
| `--theme-terminal-ansi-bright-green` | color | `#23d18b` |  |  | standard | ANSI bright green |
| `--theme-terminal-ansi-yellow` | color | `#e5e510` |  |  | standard | ANSI yellow |
| `--theme-terminal-ansi-bright-yellow` | color | `#f5f543` |  |  | standard | ANSI bright yellow |
| `--theme-terminal-ansi-blue` | color | `#2472c8` |  |  | standard | ANSI blue |
| `--theme-terminal-ansi-bright-blue` | color | `#3b8eea` |  |  | standard | ANSI bright blue |
| `--theme-terminal-ansi-magenta` | color | `#bc3fbc` |  |  | standard | ANSI magenta |
| `--theme-terminal-ansi-bright-magenta` | color | `#d670d6` |  |  | standard | ANSI bright magenta |
| `--theme-terminal-ansi-cyan` | color | `#11a8cd` |  |  | standard | ANSI cyan |
| `--theme-terminal-ansi-bright-cyan` | color | `#29b8db` |  |  | standard | ANSI bright cyan |
| `--theme-terminal-ansi-white` | color | `#e5e5e5` |  |  | standard | ANSI white |
| `--theme-terminal-ansi-bright-white` | color | `#e5e5e5` |  |  | standard | ANSI bright white |

## Overlay scrim

Group id `overlay-scrim`, 3 tokens.

The dark layer behind lightboxes, image viewers and dialogs, and the text and glass buttons on it. Every overlay is the scrim colour at some strength; --theme-scrim-strength sets the full-screen one.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-scrim` | color | `rgb(0 0 0)` |  |  | standard | Scrim colour |
| `--theme-scrim-strength` | opacity | `85%` |  |  | standard | Scrim strength. How opaque the full-screen overlay is. Lighter overlays (captions, dialog backdrop) use fixed shares of the scrim colour. |
| `--theme-scrim-foreground` | color | `rgb(255 255 255)` |  |  | standard | Text on the scrim |

## Interaction states

Group id `interaction`, 2 tokens.

What hovering does. A solid fill (a primary or destructive button, a link) mixes toward the shade; a quiet surface (a tab, a filter chip) mixes in a little of the tint. Each component keeps its own share, so a theme changes the direction here and the amount per component.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-hover-shade` | color | `black` |  |  | standard | Hover shade. The colour a solid fill mixes toward on hover. Black darkens; a dark theme may prefer white. |
| `--theme-hover-tint` | color | `var(--theme-foreground)` |  |  | standard | Hover tint. The colour a quiet surface takes a little of on hover. |

## Font stacks

Group id `fonts`, 5 tokens.

System fonts only, the best default on each OS. These five are the semantic tier's type tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--theme-font-sans` | font-family | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |  |  | standard | Font sans |
| `--theme-font-serif` | font-family | `Georgia, Cambria, "Times New Roman", Times, serif` |  |  | standard | Font serif |
| `--theme-font-mono` | font-family | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` |  |  | standard | Font mono |
| `--theme-font-brand` | font-family | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |  |  | standard | Font brand |
| `--theme-font-chat-user` | font-family | `var(--theme-font-sans)` |  |  | standard | Font chat user |

## Button

Group id `button`, 28 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-button-radius` | radius | `var(--radius-md)` |  |  | standard | Button radius |
| `--qt-button-padding-x` | length | `0.875rem` |  |  | standard | Button horizontal padding |
| `--qt-button-padding-y` | length | `0.4375rem` |  | density=comfortable: `0.5rem` | standard | Button vertical padding |
| `--qt-button-font-size` | length | `0.875rem` |  |  | standard | Button font size |
| `--qt-button-font-weight` | font-weight | `500` |  |  | advanced | Button font weight |
| `--qt-button-transition` | transition | `all 150ms cubic-bezier(0.4, 0, 0.2, 1)` |  |  | standard | Button transition |
| `--qt-button-letter-spacing` | length | `normal` (optional; unset by default) |  |  | standard | Button letter spacing. Read by .qt-button; unset keeps what the element had (a <button> its browser default, a link-styled button what it inherits). |
| `--qt-button-text-transform` | keyword | `none` (optional; unset by default) |  |  | standard | Button text transform. Read by .qt-button; unset keeps what the element had. One of: `none`, `capitalize`, `uppercase`, `lowercase`, `full-width`, `full-size-kana`. |
| `--qt-button-primary-bg` | color | `var(--color-primary)` |  |  | standard | Button primary background |
| `--qt-button-primary-fg` | color | `var(--color-primary-foreground)` |  |  | standard | Button primary text colour |
| `--qt-button-primary-hover-bg` | color | `color-mix(in srgb, var(--color-primary) 88%, var(--theme-hover-shade))` |  |  | standard | Button primary hover background |
| `--qt-button-primary-shadow` | shadow | `0 1px 3px -1px rgb(0 0 0 / 0.12)` |  |  | standard | Button primary shadow |
| `--qt-button-secondary-bg` | color | `var(--color-secondary)` |  |  | advanced | Button secondary background |
| `--qt-button-secondary-fg` | color | `var(--color-secondary-foreground)` |  |  | advanced | Button secondary text colour |
| `--qt-button-secondary-border` | color | `var(--color-border)` |  |  | advanced | Button secondary border |
| `--qt-button-secondary-hover-bg` | color | `color-mix(in srgb, var(--color-secondary) 85%, var(--theme-hover-shade))` |  |  | standard | Button secondary hover background |
| `--qt-button-ghost-bg` | color | `transparent` |  |  | advanced | Button ghost background |
| `--qt-button-ghost-fg` | color | `var(--color-foreground)` |  |  | advanced | Button ghost text colour |
| `--qt-button-ghost-hover-bg` | color | `var(--color-muted)` |  |  | advanced | Button ghost hover background |
| `--qt-button-destructive-bg` | color | `var(--color-destructive)` |  |  | advanced | Button destructive background |
| `--qt-button-destructive-fg` | color | `var(--color-destructive-foreground)` |  |  | advanced | Button destructive text colour |
| `--qt-button-destructive-hover-bg` | color | `color-mix(in srgb, var(--color-destructive) 88%, var(--theme-hover-shade))` |  |  | standard | Button destructive hover background |
| `--qt-button-success-bg` | color | `var(--color-success)` |  |  | advanced | Button success background |
| `--qt-button-success-fg` | color | `var(--color-success-foreground)` |  |  | advanced | Button success text colour |
| `--qt-button-success-hover-bg` | color | `color-mix(in srgb, var(--color-success) 85%, var(--theme-hover-shade))` |  |  | advanced | Button success hover background |
| `--qt-button-warning-bg` | color | `var(--color-warning)` |  |  | advanced | Button warning background |
| `--qt-button-warning-fg` | color | `var(--color-warning-foreground)` |  |  | advanced | Button warning text colour |
| `--qt-button-warning-hover-bg` | color | `color-mix(in srgb, var(--color-warning) 85%, var(--theme-hover-shade))` |  |  | advanced | Button warning hover background |

## Status

Group id `status`, 20 tokens.

Backgrounds are the status colour at full strength: each X / XForeground token pair is held to 4.5:1, and the old 85% mix let the page show through and dropped white-on-colour badges to ~3.7:1 (WCAG 1.4.3).

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-status-success-bg` | color | `var(--color-success)` |  |  | advanced | Status success background |
| `--qt-status-success-fg` | color | `var(--color-success-foreground)` |  |  | advanced | Status success text colour |
| `--qt-status-success-border` | color | `var(--color-success)` |  |  | advanced | Status success border |
| `--qt-status-warning-bg` | color | `var(--color-warning)` |  |  | advanced | Status warning background |
| `--qt-status-warning-fg` | color | `var(--color-warning-foreground)` |  |  | advanced | Status warning text colour |
| `--qt-status-warning-border` | color | `var(--color-warning)` |  |  | advanced | Status warning border |
| `--qt-status-info-bg` | color | `var(--color-info)` |  |  | advanced | Status info background |
| `--qt-status-info-fg` | color | `var(--color-info-foreground)` |  |  | advanced | Status info text colour |
| `--qt-status-info-border` | color | `var(--color-info)` |  |  | advanced | Status info border |
| `--qt-status-danger-bg` | color | `var(--color-destructive)` |  |  | advanced | Status danger background |
| `--qt-status-danger-fg` | color | `var(--color-destructive-foreground)` |  |  | advanced | Status danger text colour |
| `--qt-status-danger-border` | color | `var(--color-destructive)` |  |  | advanced | Status danger border |
| `--qt-punctuation-warning-bg` | color | `color-mix(in srgb, var(--color-warning) 35%, transparent)` |  |  | advanced | Punctuation warning background. Composer punctuation warnings (PunctuationLintPlugin, ::highlight) |
| `--qt-punctuation-warning-underline` | color | `var(--color-warning)` |  |  | advanced | Punctuation warning underline |
| `--qt-punctuation-no-dialogue-bg` | color | `color-mix(in srgb, var(--color-warning) 14%, transparent)` |  |  | advanced | Punctuation no dialogue background. Prose mode (Novel-like templates): no dialogue in the draft at all |
| `--qt-punctuation-no-dialogue-underline` | color | `var(--color-warning)` |  |  | advanced | Punctuation no dialogue underline |
| `--qt-composer-narration-fg` | color | `color-mix(in srgb, var(--color-foreground) 65%, var(--color-primary))` |  |  | advanced | Composer narration text colour. Prose mode composer preview: narration, and ((out of character)) asides |
| `--qt-composer-narration-bg` | color | `color-mix(in srgb, var(--color-primary) 7%, transparent)` |  |  | advanced | Composer narration background |
| `--qt-composer-ooc-fg` | color | `var(--qt-rp-ooc-color)` |  |  | advanced | Composer out-of-character text colour |
| `--qt-composer-ooc-bg` | color | `var(--qt-rp-ooc-bg)` |  |  | advanced | Composer out-of-character background |

## Alert

Group id `alert`, 12 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-alert-success-bg` | color | `color-mix(in srgb, var(--theme-status-success) var(--theme-status-tint), transparent)` |  |  | standard | Alert success background |
| `--qt-alert-success-fg` | color | `var(--theme-status-success-foreground)` |  |  | standard | Alert success text colour |
| `--qt-alert-success-border` | color | `color-mix(in srgb, var(--theme-status-success) var(--theme-status-edge), transparent)` |  |  | standard | Alert success border |
| `--qt-alert-warning-bg` | color | `color-mix(in srgb, var(--theme-status-warning) var(--theme-status-tint), transparent)` |  |  | standard | Alert warning background |
| `--qt-alert-warning-fg` | color | `var(--theme-status-warning-foreground)` |  |  | standard | Alert warning text colour |
| `--qt-alert-warning-border` | color | `color-mix(in srgb, var(--theme-status-warning) var(--theme-status-edge), transparent)` |  |  | standard | Alert warning border |
| `--qt-alert-error-bg` | color | `color-mix(in srgb, var(--theme-status-danger) var(--theme-status-tint), transparent)` |  |  | standard | Alert error background |
| `--qt-alert-error-fg` | color | `var(--theme-status-danger-foreground)` |  |  | standard | Alert error text colour |
| `--qt-alert-error-border` | color | `color-mix(in srgb, var(--theme-status-danger) var(--theme-status-edge), transparent)` |  |  | standard | Alert error border |
| `--qt-alert-info-bg` | color | `color-mix(in srgb, var(--theme-status-info) var(--theme-status-tint), transparent)` |  |  | standard | Alert info background |
| `--qt-alert-info-fg` | color | `var(--theme-status-info-foreground)` |  |  | standard | Alert info text colour |
| `--qt-alert-info-border` | color | `color-mix(in srgb, var(--theme-status-info) var(--theme-status-edge), transparent)` |  |  | standard | Alert info border |

## Card

Group id `card`, 11 tokens.

Restrained shadows — visible but never showy. Tighter radii.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-card-radius` | radius | `var(--radius-lg)` |  |  | advanced | Card radius |
| `--qt-card-padding` | length | `1.25rem` |  | density=comfortable: `1.5rem` | standard | Card padding |
| `--qt-card-bg` | color | `var(--color-card)` |  |  | advanced | Card background |
| `--qt-card-fg` | color | `var(--color-card-foreground)` |  |  | advanced | Card text colour |
| `--qt-card-border` | color | `var(--color-border)` |  |  | standard | Card border |
| `--qt-card-border-opacity` | opacity | `0.6` | `0.75` |  | standard | Card border opacity |
| `--qt-card-shadow` | shadow | `0 1px 3px hsl(225 18% 10% / 0.06), 0 1px 2px hsl(225 18% 10% / 0.04)` | `0 1px 3px hsl(225 12% 0% / 0.25), 0 0 1px hsl(225 12% 100% / 0.04)` |  | standard | Card shadow |
| `--qt-card-shadow-hover` | shadow | `0 4px 12px hsl(225 18% 10% / 0.1), 0 2px 4px hsl(225 18% 10% / 0.05)` | `0 4px 12px hsl(225 12% 0% / 0.35), 0 0 1px hsl(225 12% 100% / 0.06)` |  | standard | Card shadow hover |
| `--qt-card-transition` | transition | `all 150ms cubic-bezier(0.4, 0, 0.2, 1)` |  |  | standard | Card transition |
| `--qt-entity-card-radius` | radius | `var(--radius-lg)` |  |  | standard | Entity card radius |
| `--qt-entity-card-bg` | color | `color-mix(in srgb, var(--color-card) 92%, transparent)` |  |  | standard | Entity card background |

## Input

Group id `input`, 9 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-input-radius` | radius | `var(--radius-md)` |  |  | advanced | Input radius |
| `--qt-input-padding-x` | length | `0.75rem` |  |  | advanced | Input horizontal padding |
| `--qt-input-padding-y` | length | `0.5rem` |  |  | advanced | Input vertical padding |
| `--qt-input-bg` | color | `var(--color-background)` |  |  | standard | Input background |
| `--qt-input-fg` | color | `var(--color-foreground)` |  |  | advanced | Input text colour |
| `--qt-input-border` | color | `var(--color-input)` |  |  | advanced | Input border |
| `--qt-input-focus-ring` | color | `var(--color-ring)` |  |  | advanced | Input focus ring |
| `--qt-input-transition` | transition | `colors 150ms cubic-bezier(0.4, 0, 0.2, 1)` |  |  | advanced | Input transition |
| `--qt-select-arrow` | image | `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")` | `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")` |  | standard | Select arrow. Select dropdown arrow — a full data URI so themes can swap the whole glyph. Default stroke is a neutral slate that reads on light surfaces; the dark baseline below lifts it. Themes override --qt-select-arrow wholesale. |

## Checkbox and radio

Group id `checkbox-radio`, 9 tokens.

accent-color is the real theming hook for native controls (the fill/check); the border/size/radius tokens take effect for appearance:none themes.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-checkbox-size` | length | `1rem` |  |  | advanced | Checkbox size |
| `--qt-checkbox-radius` | radius | `var(--radius-sm)` |  |  | advanced | Checkbox radius |
| `--qt-checkbox-border` | color | `var(--color-border)` |  |  | advanced | Checkbox border |
| `--qt-checkbox-accent` | color | `var(--color-primary)` |  |  | advanced | Checkbox accent |
| `--qt-checkbox-focus-ring` | color | `var(--color-ring)` |  |  | advanced | Checkbox focus ring |
| `--qt-radio-size` | length | `1rem` |  |  | advanced | Radio size |
| `--qt-radio-border` | color | `var(--color-border)` |  |  | advanced | Radio border |
| `--qt-radio-accent` | color | `var(--color-primary)` |  |  | advanced | Radio accent |
| `--qt-radio-focus-ring` | color | `var(--color-ring)` |  |  | advanced | Radio focus ring |

## Range (slider)

Group id `range`, 2 tokens.

Sliders stay natively rendered on purpose. accent-color is what paints the filled portion of the track *and* the thumb, in every engine we target, so it is the whole theming story for the default look. Do NOT "improve" this into `appearance: none` with a custom ::-webkit-slider-runnable-track / ::-webkit-slider-thumb pair: appearance:none discards the filled bar in Chrome and Safari (Firefox alone keeps it, via ::-moz-range-progress), so a hand-built track trades the value affordance for styling reach and looks different per browser. A theme that genuinely wants a bespoke slider can still opt in by overriding .qt-range itself.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-range-accent` | color | `var(--color-primary)` |  |  | advanced | Range accent |
| `--qt-range-focus-ring` | color | `var(--color-ring)` |  |  | advanced | Range focus ring |

## Navbar

Group id `navbar`, 11 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-navbar-height` | length | `3.5rem` |  | density=comfortable: `4rem` | standard | Navbar height |
| `--qt-navbar-bg` | color | `var(--color-background)` |  |  | advanced | Navbar background |
| `--qt-navbar-border` | color | `var(--color-border)` |  |  | advanced | Navbar border |
| `--qt-navbar-blur` | blur | `blur(12px)` |  |  | standard | Navbar blur |
| `--qt-navbar-shadow` | shadow | `none` |  |  | advanced | Navbar shadow |
| `--qt-navbar-link-padding-x` | length | `0.625rem` |  | density=comfortable: `0.75rem` | standard | Navbar link horizontal padding |
| `--qt-navbar-link-padding-y` | length | `0.375rem` |  |  | standard | Navbar link vertical padding |
| `--qt-navbar-link-radius` | radius | `var(--radius-md)` |  |  | advanced | Navbar link radius |
| `--qt-navbar-link-fg` | color | `var(--color-foreground)` |  |  | advanced | Navbar link text colour |
| `--qt-navbar-link-hover-bg` | color | `var(--color-muted)` |  |  | advanced | Navbar link hover background |
| `--qt-navbar-link-active-bg` | color | `var(--color-muted)` |  |  | advanced | Navbar link active background |

## Page

Group id `page`, 19 tokens.

App-owned rules on the root: colour scheme, text selection, scrollbars, the focus ring and an optional page background image. They live in _base.css in cascade layers (or, for the page background, behind an attribute), so a theme's own unlayered rules still win.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-color-scheme` | keyword | `normal` |  |  | standard | Colour scheme. color-scheme on the root (form controls, scrollbars, system colours). "normal" leaves the browser default; set "dark" or "light" per mode. One of: `normal`, `light`, `dark`, `light dark`, `only light`, `only dark`. |
| `--qt-body-font-weight` | font-weight | `400` (optional; unset by default) |  |  | standard | Body text weight. font-weight on the root, inherited by all text that sets none of its own (300 for a light face). Unset leaves the browser's normal weight. |
| `--qt-selection-bg` | color | `hsl(225 55% 48% / 0.18)` |  |  | standard | Text selection background. The ::selection rule in _base.css. A theme's own unlayered ::selection rule still wins. |
| `--qt-selection-fg` | color | `var(--color-foreground)` |  |  | standard | Text selection text colour |
| `--qt-scrollbar-width` | keyword | `thin` |  |  | advanced | Scrollbar width. scrollbar-width on the root: auto, thin or none. One of: `auto`, `thin`, `none`. |
| `--qt-scrollbar-thumb` | color | `auto` (optional; unset by default) |  |  | standard | Scrollbar thumb. Read as scrollbar-color on the root together with the track; unset leaves the browser's scrollbar. Set it and the track together. |
| `--qt-scrollbar-track` | color | `transparent` (optional; unset by default) |  |  | standard | Scrollbar track. Read as scrollbar-color on the root together with the thumb. |
| `--qt-scrollbar-thumb-hover` | color | `var(--qt-scrollbar-thumb)` (optional; unset by default) |  |  | advanced | Scrollbar thumb (hovered). For browsers that only style scrollbars through ::-webkit-scrollbar (Safari). Applies only while <html> carries data-qt-scrollbar, which the theme provider sets for a theme that asks for it. |
| `--qt-scrollbar-size` | length | `8px` |  |  | advanced | Scrollbar size. The ::-webkit-scrollbar width and height. Applies only while <html> carries data-qt-scrollbar, which the theme provider sets for a theme that asks for it. |
| `--qt-scrollbar-radius` | radius | `9999px` |  |  | advanced | Scrollbar thumb radius. The ::-webkit-scrollbar-thumb radius. Applies only while <html> carries data-qt-scrollbar, which the theme provider sets for a theme that asks for it. |
| `--qt-focus-ring-color` | color | `var(--color-ring)` |  |  | standard | Focus ring colour. The app's :focus-visible ring: --theme-focus-ring-width wide in this colour, --theme-focus-ring-offset out. Applies only while <html> carries data-qt-focus-ring, which the theme provider sets for a theme that asks for it. |
| `--qt-focus-ring-glow` | shadow | `none` |  |  | standard | Focus ring glow. An optional box-shadow added to the focus ring, e.g. 0 0 0 4px color-mix(in srgb, var(--color-ring) 30%, transparent). |
| `--qt-page-background-image` | image | `none` |  |  | standard | Page background image. An image (or a list with gradients) painted behind the whole app. While it is set the theme provider marks <html> with data-qt-page-background, and the app makes its page surfaces transparent over it — except while a story background or a dynamic-backgrounds collage is showing on the visible page, which takes precedence. Per mode: set a dark value for dark mode. |
| `--qt-page-background-size` | raw | `cover` |  |  | advanced | Page background size |
| `--qt-page-background-position` | raw | `center center` |  |  | advanced | Page background position |
| `--qt-page-background-attachment` | keyword | `fixed` |  |  | advanced | Page background attachment One of: `scroll`, `fixed`, `local`. |
| `--qt-page-background-repeat` | keyword | `no-repeat` |  |  | advanced | Page background repeat One of: `repeat`, `no-repeat`, `repeat-x`, `repeat-y`, `space`, `round`. |
| `--qt-page-background-texture` | image | `none` |  |  | advanced | Page background texture. A tiling image laid over the page background at --qt-page-background-texture-opacity (a weave, paper grain). Shown only while the page background is, so a story background hides it too. |
| `--qt-page-background-texture-opacity` | opacity | `0.05` |  |  | advanced | Page background texture opacity |

## Content area

Group id `content-area`, 3 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-content-bg` | color | `var(--color-card)` |  |  | advanced | Content background |
| `--qt-content-fg` | color | `var(--color-card-foreground)` |  |  | advanced | Content text colour |
| `--qt-content-scroll-bg` | color | `var(--color-background)` |  |  | advanced | Content scroll background |

## Typography

Group id `typography`, 6 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-heading-font` | font-family | `var(--font-sans)` |  |  | standard | Heading font |
| `--qt-text-secondary-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Text secondary text colour |
| `--qt-heading-font-weight` | font-weight | `600` (optional; unset by default) |  |  | standard | Heading weight. Read by the .qt-heading-* classes; unset, each level keeps its own weight (bold for .qt-heading-1, semibold for the rest). |
| `--qt-heading-letter-spacing` | length | `normal` (optional; unset by default) |  |  | standard | Heading letter spacing. Read by the .qt-heading-* classes; unset, each level keeps its own spacing (tight for -1, -2 and -lg, normal for the rest). |
| `--qt-heading-text-transform` | keyword | `none` (optional; unset by default) |  |  | standard | Heading text transform. Read by the .qt-heading-* classes; unset, each level keeps its own inherited transform. One of: `none`, `capitalize`, `uppercase`, `lowercase`, `full-width`, `full-size-kana`. |
| `--qt-heading-color` | color | `inherit` (optional; unset by default) |  |  | standard | Heading colour. Read by the .qt-heading-* classes; unset, each level keeps its own inherited colour. |

## Sidebar

Group id `sidebar`, 9 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-sidebar-width` | length | `15rem` |  |  | standard | Sidebar width |
| `--qt-sidebar-bg` | color | `var(--color-sidebar-background)` |  |  | advanced | Sidebar background |
| `--qt-sidebar-border` | color | `var(--color-sidebar-border)` |  |  | advanced | Sidebar border |
| `--qt-sidebar-item-padding-x` | length | `0.625rem` |  |  | standard | Sidebar item horizontal padding |
| `--qt-sidebar-item-padding-y` | length | `0.375rem` |  |  | standard | Sidebar item vertical padding |
| `--qt-sidebar-item-radius` | radius | `var(--radius-md)` |  |  | advanced | Sidebar item radius |
| `--qt-sidebar-item-hover-bg` | color | `var(--color-sidebar-accent)` |  |  | standard | Sidebar item hover background |
| `--qt-sidebar-item-active-bg` | color | `color-mix(in srgb, var(--color-primary) 8%, transparent)` |  |  | standard | Sidebar item active background |
| `--qt-sidebar-item-active-border` | color | `var(--color-primary)` |  |  | standard | Sidebar item active border |

## Left sidebar (app navigation)

Group id `left-sidebar`, 11 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-left-sidebar-width` | length | `15rem` |  | density=comfortable: `16rem` | standard | Left sidebar width |
| `--qt-left-sidebar-collapsed-width` | length | `3.5rem` |  | density=comfortable: `4rem` | standard | Left sidebar collapsed width |
| `--qt-left-sidebar-resize-handle-width` | length | `3px` |  | density=comfortable: `4px` | standard | Left sidebar resize handle width |
| `--qt-left-sidebar-bg` | color | `var(--color-sidebar-background)` |  |  | standard | Left sidebar background |
| `--qt-left-sidebar-border` | color | `var(--color-sidebar-border)` |  |  | standard | Left sidebar border |
| `--qt-left-sidebar-transition` | transition | `width 200ms ease, transform 300ms ease` |  |  | advanced | Left sidebar transition |
| `--qt-left-sidebar-section-padding` | length | `0.625rem` |  | density=comfortable: `0.75rem` | standard | Left sidebar section padding |
| `--qt-left-sidebar-section-gap` | length | `0.125rem` |  | density=comfortable: `0.25rem` | standard | Left sidebar section gap |
| `--qt-left-sidebar-section-title-fg` | color | `var(--color-sidebar-muted)` |  |  | standard | Left sidebar section title text colour |
| `--qt-left-sidebar-item-icon-size` | length | `1.125rem` |  | density=comfortable: `1.25rem` | standard | Left sidebar item icon size |
| `--qt-left-sidebar-z` | z-index | `50` |  |  | advanced | Left sidebar z-index |

## App header

Group id `app-header`, 4 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-app-header-height` | length | `3.5rem` |  | density=comfortable: `4rem` | standard | App header height |
| `--qt-app-header-bg` | color | `var(--color-background)` |  |  | advanced | App header background |
| `--qt-app-header-border` | color | `var(--color-border)` |  |  | advanced | App header border |
| `--qt-app-header-blur` | blur | `blur(12px)` |  |  | standard | App header blur |

## Panel, dialog and popover

Group id `panel-dialog-popover`, 25 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-panel-radius` | radius | `var(--radius-lg)` |  |  | advanced | Panel radius |
| `--qt-panel-bg` | color | `var(--color-card)` |  |  | advanced | Panel background |
| `--qt-panel-border` | color | `var(--color-border)` |  |  | advanced | Panel border |
| `--qt-panel-shadow` | shadow | `0 8px 24px -4px rgb(0 0 0 / 0.08)` |  |  | standard | Panel shadow |
| `--qt-dialog-radius` | radius | `var(--radius-lg)` |  |  | advanced | Dialog radius |
| `--qt-dialog-bg` | color | `var(--color-background)` |  |  | advanced | Dialog background |
| `--qt-dialog-border` | color | `var(--color-border)` |  |  | standard | Dialog border |
| `--qt-dialog-border-width` | length | `1px` |  |  | advanced | Dialog border width |
| `--qt-dialog-shadow` | shadow | `0 24px 48px -12px rgb(0 0 0 / 0.18)` |  |  | standard | Dialog shadow |
| `--qt-dialog-backdrop` | color | `color-mix(in srgb, var(--theme-scrim) 45%, transparent)` |  |  | standard | Dialog backdrop |
| `--qt-floating-layer-z` | z-index | `1000` |  |  | advanced | Floating layer z-index. Topmost floating layer — above every portal modal (z ≤ 101), below the startup gates (z 9999). Holds the always-on Brahma Console. |
| `--qt-brahma-launcher-size` | length | `2.75rem` |  |  | advanced | Brahma launcher size. Brahma Console launcher — the always-on button beside the left rail |
| `--qt-brahma-launcher-offset` | length | `0.75rem` |  |  | advanced | Brahma launcher offset |
| `--qt-brahma-launcher-bg` | color | `var(--color-primary)` |  |  | advanced | Brahma launcher background |
| `--qt-brahma-launcher-fg` | color | `var(--color-primary-foreground)` |  |  | advanced | Brahma launcher text colour |
| `--qt-brahma-launcher-hover-bg` | color | `color-mix(in srgb, var(--color-primary) 88%, var(--theme-hover-shade))` |  |  | advanced | Brahma launcher hover background |
| `--qt-brahma-launcher-active-bg` | color | `var(--color-background)` |  |  | advanced | Brahma launcher active background |
| `--qt-brahma-launcher-active-fg` | color | `var(--color-primary)` |  |  | advanced | Brahma launcher active text colour |
| `--qt-brahma-launcher-ring` | color | `var(--color-primary)` |  |  | advanced | Brahma launcher ring |
| `--qt-brahma-launcher-shadow` | shadow | `0 6px 18px -4px rgb(0 0 0 / 0.35)` |  |  | advanced | Brahma launcher shadow |
| `--qt-popover-radius` | radius | `var(--radius-md)` |  |  | advanced | Popover radius |
| `--qt-popover-bg` | color | `var(--color-popover)` |  |  | advanced | Popover background |
| `--qt-popover-fg` | color | `var(--color-popover-foreground)` |  |  | advanced | Popover text colour |
| `--qt-popover-border` | color | `var(--color-border)` |  |  | advanced | Popover border |
| `--qt-popover-shadow` | shadow | `0 8px 24px -4px rgb(0 0 0 / 0.1)` |  |  | standard | Popover shadow |

## Chat

Group id `chat`, 75 tokens.

Sans-serif throughout — no serif in assistant messages. The user bubble matches the primary hue for brand cohesion.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-chat-message-radius` | radius | `var(--radius-lg)` |  |  | advanced | Chat message radius |
| `--qt-chat-message-padding` | length | `0.875rem` |  | density=comfortable: `1rem` | standard | Chat message padding |
| `--qt-chat-message-shadow` | shadow | `0 1px 4px -1px rgb(0 0 0 / 0.06)` |  |  | standard | Chat message shadow |
| `--qt-chat-user-bg` | color | `var(--color-chat-user)` |  |  | advanced | Chat user background |
| `--qt-chat-user-fg` | color | `var(--color-chat-user-foreground)` |  |  | advanced | Chat user text colour |
| `--qt-chat-user-border` | color | `transparent` |  |  | standard | Chat user border |
| `--qt-chat-user-font` | font-family | `var(--font-sans)` |  |  | standard | Chat user font |
| `--qt-chat-assistant-bg` | color | `var(--theme-chat-assistant)` |  |  | advanced | Chat assistant background |
| `--qt-chat-assistant-fg` | color | `var(--theme-chat-assistant-foreground)` |  |  | advanced | Chat assistant text colour |
| `--qt-chat-assistant-border` | color | `var(--color-border)` |  |  | advanced | Chat assistant border |
| `--qt-chat-assistant-font` | font-family | `var(--font-sans)` |  |  | standard | Chat assistant font |
| `--qt-chat-assistant-font-weight` | font-weight | `inherit` |  |  | advanced | Chat assistant font weight |
| `--qt-chat-whisper-bg` | color | `color-mix(in srgb, var(--qt-chat-assistant-bg) 60%, var(--theme-chat-whisper) 40%)` |  |  | standard | Chat whisper background. Chat: Whisper messages |
| `--qt-chat-whisper-fg` | color | `var(--qt-chat-assistant-fg)` |  |  | advanced | Chat whisper text colour |
| `--qt-chat-whisper-border` | color | `var(--theme-chat-whisper)` |  |  | standard | Chat whisper border |
| `--qt-chat-whisper-label-fg` | color | `var(--theme-chat-whisper-foreground)` |  |  | standard | Chat whisper label text colour. Deep enough to clear WCAG AA (4.5:1) against --qt-chat-whisper-bg at this label's 0.75rem size; it also tints .qt-chat-system-bar-whisper. |
| `--qt-chat-silent-bg` | color | `color-mix(in srgb, var(--qt-chat-assistant-bg) 65%, var(--theme-chat-silent) 35%)` |  |  | standard | Chat silent background. Chat: Silent messages — inner thoughts/actions from characters in silent mode |
| `--qt-chat-silent-fg` | color | `var(--qt-chat-assistant-fg)` |  |  | advanced | Chat silent text colour |
| `--qt-chat-silent-border` | color | `var(--theme-chat-silent)` |  |  | standard | Chat silent border |
| `--qt-chat-silent-label-fg` | color | `var(--theme-chat-silent-foreground)` |  |  | standard | Chat silent label text colour |
| `--qt-chat-thinking-fg` | color | `color-mix(in srgb, var(--qt-chat-assistant-fg) 55%, transparent)` | `color-mix(in srgb, var(--qt-chat-assistant-fg) 60%, transparent)` |  | advanced | Chat thinking text colour. Chat: Thinking / reasoning blocks — a thinking model's chain-of-thought, shown dimmed, italic, and right-justified. DISPLAY ONLY. Defaults dim the assistant foreground and lean on a faint muted backdrop; themes may override, and untouched themes fall back to these via the silent tokens. |
| `--qt-chat-thinking-bg` | color | `color-mix(in srgb, var(--qt-chat-silent-bg) 40%, transparent)` |  |  | advanced | Chat thinking background |
| `--qt-chat-thinking-border` | color | `color-mix(in srgb, var(--qt-chat-silent-border) 60%, transparent)` |  |  | advanced | Chat thinking border |
| `--qt-chat-thinking-label-fg` | color | `var(--qt-chat-silent-label-fg)` |  |  | advanced | Chat thinking label text colour |
| `--qt-chat-wardrobe-bg` | color | `color-mix(in srgb, var(--qt-chat-assistant-bg) 60%, var(--theme-chat-wardrobe) 40%)` |  |  | standard | Chat wardrobe background. Chat: Wardrobe action notices — warm amber/gold for dressing room actions |
| `--qt-chat-wardrobe-fg` | color | `var(--qt-chat-assistant-fg)` |  |  | advanced | Chat wardrobe text colour |
| `--qt-chat-wardrobe-border` | color | `var(--theme-chat-wardrobe)` |  |  | standard | Chat wardrobe border |
| `--qt-chat-wardrobe-label-fg` | color | `var(--theme-chat-wardrobe-foreground)` |  |  | standard | Chat wardrobe label text colour |
| `--qt-chat-system-bar-bg` | color | `color-mix(in srgb, var(--qt-chat-assistant-bg) 70%, var(--theme-chat-system) 30%)` | `color-mix(in srgb, var(--qt-chat-assistant-bg) 60%, var(--theme-chat-system) 40%)` |  | advanced | Chat system bar background. Chat: System-message collapsed bar — thin one-line summary for Staff-authored messages |
| `--qt-chat-system-bar-fg` | color | `var(--theme-chat-system-foreground)` |  |  | advanced | Chat system bar text colour |
| `--qt-chat-system-bar-border` | color | `var(--color-border)` |  |  | advanced | Chat system bar border |
| `--qt-chat-system-bar-hover-bg` | color | `color-mix(in srgb, var(--qt-chat-assistant-bg) 55%, var(--theme-chat-system) 45%)` | `color-mix(in srgb, var(--qt-chat-assistant-bg) 45%, var(--theme-chat-system) 55%)` |  | advanced | Chat system bar hover background |
| `--qt-chat-system-bar-sender-fg` | color | `var(--color-foreground)` |  |  | advanced | Chat system bar sender text colour |
| `--qt-chat-announcement-dot-high` | color | `var(--color-destructive, #b4452e)` | `#e06a52` |  | advanced | Chat announcement dot high. Chat: Announcement importance dots — high (red), medium (amber), low (hollow grey). All three track theme tokens so the dots stay on-palette: high follows the theme destructive, medium the theme warning, low the muted foreground. The hardcoded amber/red remain as fallbacks for any theme that omits the token. |
| `--qt-chat-announcement-dot-medium` | color | `var(--color-warning, #d08a1e)` | `var(--color-warning, #e3a94a)` |  | advanced | Chat announcement dot medium |
| `--qt-chat-announcement-dot-low` | color | `var(--color-muted-foreground)` |  |  | advanced | Chat announcement dot low |
| `--qt-chat-composer-bg` | color | `var(--color-background)` |  |  | advanced | Chat composer background |
| `--qt-chat-composer-border` | color | `var(--color-border)` |  |  | advanced | Chat composer border |
| `--qt-chat-composer-radius` | radius | `var(--radius-lg)` |  |  | advanced | Chat composer radius |
| `--qt-chat-composer-padding-x` | length | `1rem` |  |  | standard | Chat composer horizontal padding |
| `--qt-chat-composer-padding-y` | length | `0.75rem` |  |  | standard | Chat composer vertical padding |
| `--qt-chat-toolbar-gap` | length | `0.375rem` |  |  | standard | Chat toolbar gap |
| `--qt-chat-toolbar-button-bg` | color | `var(--color-muted)` |  |  | advanced | Chat toolbar button background |
| `--qt-chat-toolbar-button-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Chat toolbar button text colour |
| `--qt-chat-toolbar-button-hover-bg` | color | `color-mix(in srgb, var(--color-muted) 85%, transparent)` |  |  | advanced | Chat toolbar button hover background |
| `--qt-chat-toolbar-button-border` | color | `var(--color-border)` |  |  | advanced | Chat toolbar button border |
| `--qt-chat-attachment-border` | color | `var(--color-border)` |  |  | advanced | Chat attachment border |
| `--qt-chat-attachment-hover-border` | color | `var(--color-primary)` |  |  | standard | Chat attachment hover border |
| `--qt-chat-attachment-overlay` | color | `rgb(0 0 0 / 0.2)` |  |  | standard | Chat attachment overlay |
| `--qt-chat-message-row-max-width` | length | `900px` |  |  | advanced | Chat message row max width |
| `--qt-page-max-width` | length | `72rem` |  | density=comfortable: `75rem` | standard | Page max width |
| `--qt-card-grid-auto-min` | length | `520px` |  | density=comfortable: `550px` | standard | Card grid auto min |
| `--qt-chat-sidebar-width` | length | `18rem` |  |  | standard | Chat sidebar width |
| `--qt-chat-sidebar-collapsed-width` | length | `3.5rem` |  | density=comfortable: `4rem` | standard | Chat sidebar collapsed width |
| `--qt-chat-sidebar-bg` | color | `var(--color-card)` |  |  | advanced | Chat sidebar background |
| `--qt-chat-sidebar-border` | color | `var(--color-border)` |  |  | advanced | Chat sidebar border |
| `--qt-chat-sidebar-header-border` | color | `var(--color-border)` |  |  | advanced | Chat sidebar header border |
| `--qt-chat-sidebar-muted` | color | `var(--color-muted-foreground)` |  |  | advanced | Chat sidebar muted |
| `--qt-chat-sidebar-heading` | color | `var(--color-foreground)` |  |  | advanced | Chat sidebar heading |
| `--qt-response-status-bg` | color | `color-mix(in srgb, var(--color-muted) 60%, transparent)` | `color-mix(in srgb, var(--color-muted) 40%, transparent)` |  | standard | Response status background. Response status indicator |
| `--qt-response-status-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Response status text colour |
| `--qt-response-status-border` | color | `var(--color-border)` |  |  | advanced | Response status border |
| `--qt-response-status-compressing-fg` | color | `var(--qt-status-info-fg)` | `hsl(210 70% 68%)` |  | standard | Response status compressing text colour |
| `--qt-response-status-gathering-fg` | color | `hsl(270 55% 55%)` | `hsl(270 50% 68%)` |  | standard | Response status gathering text colour |
| `--qt-response-status-building-fg` | color | `hsl(38 85% 48%)` | `hsl(38 85% 62%)` |  | standard | Response status building text colour |
| `--qt-response-status-sending-fg` | color | `var(--qt-status-info-fg)` | `hsl(210 70% 68%)` |  | standard | Response status sending text colour |
| `--qt-response-status-streaming-fg` | color | `hsl(152 55% 29%)` | `hsl(152 55% 62%)` |  | standard | Response status streaming text colour |
| `--qt-response-status-tool-fg` | color | `hsl(270 55% 55%)` | `hsl(270 50% 68%)` |  | standard | Response status tool text colour |
| `--qt-participant-card-radius` | radius | `var(--radius-lg)` |  |  | advanced | Participant card radius |
| `--qt-participant-card-bg` | color | `var(--color-card)` |  |  | advanced | Participant card background |
| `--qt-participant-card-border` | color | `var(--color-border)` |  |  | advanced | Participant card border |
| `--qt-participant-card-active-border` | color | `var(--color-primary)` |  |  | standard | Participant card active border |
| `--qt-participant-card-active-shadow` | shadow | `0 0 8px rgb(var(--color-primary) / 0.2)` |  |  | standard | Participant card active shadow |
| `--qt-thinking-duration` | duration | `1.2s` |  |  | advanced | Thinking duration. Hook: _chat.css reads it as var(--qt-thinking-duration, 1.2s); the default is that fallback. |
| `--qt-thinking-origin` | raw | `12.5% 87.5%` |  |  | advanced | Thinking origin. Hook: _chat.css reads it as var(--qt-thinking-origin, 12.5% 87.5%); the default is that fallback. |

## Roleplay annotation

Group id `roleplay-annotation`, 31 tokens.

Subdued — this theme is for power users, not immersive RP. Annotations are functional, not atmospheric.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-rp-dialogue-color` | color | `var(--theme-roleplay-dialogue-foreground)` |  |  | advanced | Roleplay dialogue color |
| `--qt-rp-dialogue-bg` | color | `var(--theme-roleplay-dialogue)` |  |  | advanced | Roleplay dialogue background |
| `--qt-rp-narration-color` | color | `var(--theme-roleplay-narration-foreground)` |  |  | standard | Roleplay narration color |
| `--qt-rp-narration-bg` | color | `var(--theme-roleplay-narration)` |  |  | standard | Roleplay narration background |
| `--qt-rp-narration-style` | font-style | `normal` |  |  | advanced | Roleplay narration style |
| `--qt-rp-narration-padding` | length | `0.125rem 0.375rem` |  |  | advanced | Roleplay narration padding |
| `--qt-rp-narration-radius` | radius | `0.1875rem` |  |  | standard | Roleplay narration radius |
| `--qt-rp-inner-monologue-color` | color | `var(--theme-roleplay-inner-monologue-foreground)` |  |  | standard | Roleplay inner monologue color |
| `--qt-rp-inner-monologue-bg` | color | `var(--theme-roleplay-inner-monologue)` |  |  | standard | Roleplay inner monologue background |
| `--qt-rp-inner-monologue-style` | font-style | `italic` |  |  | advanced | Roleplay inner monologue style |
| `--qt-rp-inner-monologue-padding` | length | `0.125rem 0.375rem` |  |  | advanced | Roleplay inner monologue padding |
| `--qt-rp-inner-monologue-radius` | radius | `0.1875rem` |  |  | standard | Roleplay inner monologue radius |
| `--qt-rp-ooc-color` | color | `var(--theme-roleplay-ooc-foreground)` |  |  | standard | Roleplay out-of-character color |
| `--qt-rp-ooc-bg` | color | `var(--theme-roleplay-ooc)` |  |  | standard | Roleplay out-of-character background |
| `--qt-rp-ooc-font` | font-family | `var(--font-mono)` |  |  | standard | Roleplay out-of-character font |
| `--qt-rp-ooc-padding` | length | `0.125rem 0.375rem` |  |  | advanced | Roleplay out-of-character padding |
| `--qt-rp-ooc-radius` | radius | `0.1875rem` |  |  | standard | Roleplay out-of-character radius |
| `--qt-rp-button-narration-bg` | color | `hsl(225 10% 38%)` |  |  | standard | Roleplay button narration background |
| `--qt-rp-button-narration-fg` | color | `hsl(0 0% 100%)` |  |  | standard | Roleplay button narration text colour |
| `--qt-rp-button-internal-bg` | color | `hsl(270 45% 48%)` |  |  | standard | Roleplay button internal background |
| `--qt-rp-button-internal-fg` | color | `hsl(0 0% 100%)` |  |  | advanced | Roleplay button internal text colour |
| `--qt-rp-button-ooc-bg` | color | `hsl(152 60% 28%)` |  |  | standard | Roleplay button out-of-character background |
| `--qt-rp-button-ooc-fg` | color | `hsl(152 60% 80%)` |  |  | standard | Roleplay button out-of-character text colour |
| `--qt-roleplay-1-bg` | color | `var(--theme-roleplay-chip-1)` |  |  | standard | Roleplay 1 background. Roleplay-template palette (qt-roleplay-1..4): four distinct high-contrast chips a delimiter can opt into. Each chip carries its own fg/bg so it reads on any bubble; themes override these four pairs to taste. |
| `--qt-roleplay-1-fg` | color | `var(--theme-roleplay-chip-1-foreground)` |  |  | standard | Roleplay 1 text colour |
| `--qt-roleplay-2-bg` | color | `var(--theme-roleplay-chip-2)` |  |  | standard | Roleplay 2 background |
| `--qt-roleplay-2-fg` | color | `var(--theme-roleplay-chip-2-foreground)` |  |  | standard | Roleplay 2 text colour |
| `--qt-roleplay-3-bg` | color | `var(--theme-roleplay-chip-3)` |  |  | standard | Roleplay 3 background |
| `--qt-roleplay-3-fg` | color | `var(--theme-roleplay-chip-3-foreground)` |  |  | standard | Roleplay 3 text colour |
| `--qt-roleplay-4-bg` | color | `var(--theme-roleplay-chip-4)` |  |  | standard | Roleplay 4 background |
| `--qt-roleplay-4-fg` | color | `var(--theme-roleplay-chip-4-foreground)` |  |  | standard | Roleplay 4 text colour |

## Badge

Group id `badge`, 99 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-badge-radius` | radius | `9999px` |  |  | standard | Badge radius |
| `--qt-badge-padding-x` | length | `0.625rem` |  | density=comfortable: `0.75rem` | standard | Badge horizontal padding |
| `--qt-badge-padding-y` | length | `0.1875rem` |  | density=comfortable: `0.25rem` | standard | Badge vertical padding |
| `--qt-badge-font-size` | length | `0.75rem` |  |  | standard | Badge font size |
| `--qt-badge-font-weight` | font-weight | `500` |  |  | standard | Badge font weight |
| `--qt-badge-primary-bg` | color | `var(--color-primary)` |  |  | advanced | Badge primary background |
| `--qt-badge-primary-fg` | color | `var(--color-primary-foreground)` |  |  | advanced | Badge primary text colour |
| `--qt-badge-secondary-bg` | color | `var(--color-secondary)` |  |  | advanced | Badge secondary background |
| `--qt-badge-secondary-fg` | color | `var(--color-secondary-foreground)` |  |  | advanced | Badge secondary text colour |
| `--qt-badge-outline-bg` | color | `transparent` |  |  | advanced | Badge outline background |
| `--qt-badge-outline-fg` | color | `var(--color-foreground)` |  |  | advanced | Badge outline text colour |
| `--qt-badge-outline-border` | color | `var(--color-border)` |  |  | advanced | Badge outline border |
| `--qt-badge-character-bg` | color | `color-mix(in srgb, var(--theme-category-character) var(--theme-category-tint), transparent)` |  |  | standard | Badge character background. Entity-type badge colors — desaturated, professional |
| `--qt-badge-character-fg` | color | `var(--theme-category-character-foreground)` |  |  | standard | Badge character text colour |
| `--qt-badge-user-character-bg` | color | `color-mix(in srgb, var(--theme-category-user-character) var(--theme-category-tint), transparent)` |  |  | standard | Badge user character background |
| `--qt-badge-user-character-fg` | color | `var(--theme-category-user-character-foreground)` |  |  | standard | Badge user character text colour |
| `--qt-badge-chat-bg` | color | `color-mix(in srgb, var(--theme-category-chat) var(--theme-category-tint), transparent)` |  |  | standard | Badge chat background |
| `--qt-badge-chat-fg` | color | `var(--theme-category-chat-foreground)` |  |  | standard | Badge chat text colour |
| `--qt-badge-tag-bg` | color | `color-mix(in srgb, var(--theme-category-tag) var(--theme-category-tint), transparent)` |  |  | standard | Badge tag background |
| `--qt-badge-tag-fg` | color | `var(--theme-category-tag-foreground)` |  |  | standard | Badge tag text colour |
| `--qt-badge-memory-bg` | color | `color-mix(in srgb, var(--theme-category-memory) var(--theme-category-tint), transparent)` |  |  | standard | Badge memory background |
| `--qt-badge-memory-fg` | color | `var(--theme-category-memory-foreground)` |  |  | standard | Badge memory text colour |
| `--qt-badge-message-bg` | color | `color-mix(in srgb, var(--theme-category-message) var(--theme-category-tint), transparent)` |  |  | standard | Badge message background |
| `--qt-badge-message-fg` | color | `var(--theme-category-message-foreground)` |  |  | standard | Badge message text colour |
| `--qt-badge-project-bg` | color | `color-mix(in srgb, var(--theme-category-project) var(--theme-category-tint), transparent)` | `color-mix(in srgb, var(--theme-category-project) 12%, transparent)` |  | standard | Badge project background |
| `--qt-badge-project-fg` | color | `var(--theme-category-project-foreground)` |  |  | standard | Badge project text colour |
| `--qt-badge-enabled-bg` | color | `color-mix(in srgb, var(--theme-category-chat) var(--theme-category-tint), transparent)` |  |  | standard | Badge enabled background. Status badge colors |
| `--qt-badge-enabled-fg` | color | `var(--theme-category-chat-foreground)` |  |  | standard | Badge enabled text colour |
| `--qt-badge-disabled-bg` | color | `var(--color-muted)` |  |  | advanced | Badge disabled background |
| `--qt-badge-disabled-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Badge disabled text colour |
| `--qt-badge-related-bg` | color | `color-mix(in srgb, var(--theme-category-related) var(--theme-category-tint), transparent)` |  |  | standard | Badge related background |
| `--qt-badge-related-fg` | color | `var(--theme-category-related-foreground)` |  |  | standard | Badge related text colour |
| `--qt-badge-manual-bg` | color | `color-mix(in srgb, var(--theme-category-user-character) var(--theme-category-tint), transparent)` |  |  | standard | Badge manual background |
| `--qt-badge-manual-fg` | color | `var(--theme-category-user-character-foreground)` |  |  | standard | Badge manual text colour |
| `--qt-badge-auto-bg` | color | `var(--color-muted)` |  |  | advanced | Badge auto background |
| `--qt-badge-auto-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Badge auto text colour |
| `--qt-badge-source-included-bg` | color | `color-mix(in srgb, var(--theme-category-user-character) var(--theme-category-tint), transparent)` |  |  | standard | Badge source included background. Plugin source badge colors |
| `--qt-badge-source-included-fg` | color | `var(--theme-category-user-character-foreground)` |  |  | standard | Badge source included text colour |
| `--qt-badge-source-npm-bg` | color | `color-mix(in srgb, var(--theme-category-source-npm) var(--theme-category-tint), transparent)` |  |  | standard | Badge source npm background |
| `--qt-badge-source-npm-fg` | color | `var(--theme-category-source-npm-foreground)` |  |  | standard | Badge source npm text colour |
| `--qt-badge-source-git-bg` | color | `color-mix(in srgb, var(--theme-category-source-git) var(--theme-category-tint), transparent)` |  |  | standard | Badge source git background |
| `--qt-badge-source-git-fg` | color | `var(--theme-category-source-git-foreground)` |  |  | standard | Badge source git text colour |
| `--qt-badge-source-manual-bg` | color | `var(--color-muted)` |  |  | advanced | Badge source manual background |
| `--qt-badge-source-manual-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Badge source manual text colour |
| `--qt-badge-wardrobe-top-bg` | color | `color-mix(in srgb, var(--theme-category-wardrobe-top) var(--theme-category-tint), transparent)` |  |  | advanced | Badge wardrobe top background. Wardrobe slot badge colors |
| `--qt-badge-wardrobe-top-fg` | color | `var(--theme-category-wardrobe-top-foreground)` |  |  | advanced | Badge wardrobe top text colour |
| `--qt-badge-wardrobe-bottom-bg` | color | `color-mix(in srgb, var(--theme-category-wardrobe-bottom) var(--theme-category-tint), transparent)` |  |  | advanced | Badge wardrobe bottom background |
| `--qt-badge-wardrobe-bottom-fg` | color | `var(--theme-category-wardrobe-bottom-foreground)` |  |  | advanced | Badge wardrobe bottom text colour |
| `--qt-badge-wardrobe-footwear-bg` | color | `color-mix(in srgb, var(--theme-category-wardrobe-footwear) var(--theme-category-tint), transparent)` |  |  | advanced | Badge wardrobe footwear background |
| `--qt-badge-wardrobe-footwear-fg` | color | `var(--theme-category-wardrobe-footwear-foreground)` |  |  | advanced | Badge wardrobe footwear text colour |
| `--qt-badge-wardrobe-accessories-bg` | color | `color-mix(in srgb, var(--theme-category-wardrobe-accessories) var(--theme-category-tint), transparent)` |  |  | advanced | Badge wardrobe accessories background |
| `--qt-badge-wardrobe-accessories-fg` | color | `var(--theme-category-wardrobe-accessories-foreground)` |  |  | advanced | Badge wardrobe accessories text colour |
| `--qt-badge-wardrobe-hair-bg` | color | `color-mix(in srgb, var(--theme-category-wardrobe-hair) var(--theme-category-tint), transparent)` |  |  | advanced | Badge wardrobe hair background |
| `--qt-badge-wardrobe-hair-fg` | color | `var(--theme-category-wardrobe-hair-foreground)` |  |  | advanced | Badge wardrobe hair text colour |
| `--qt-badge-wardrobe-shared-bg` | color | `color-mix(in srgb, var(--theme-category-wardrobe-shared) var(--theme-category-tint), transparent)` |  |  | advanced | Badge wardrobe shared background |
| `--qt-badge-wardrobe-shared-fg` | color | `var(--theme-category-wardrobe-shared-foreground)` |  |  | advanced | Badge wardrobe shared text colour |
| `--qt-badge-capability-bg` | color | `color-mix(in srgb, var(--theme-category-capability) 8%, transparent)` | `color-mix(in srgb, var(--theme-category-capability) 18%, transparent)` |  | standard | Badge capability background. Capability badge colors |
| `--qt-badge-capability-fg` | color | `var(--theme-category-capability-foreground)` |  |  | standard | Badge capability text colour |
| `--qt-badge-autonomous-running-bg` | color | `var(--qt-status-success-bg)` |  |  | advanced | Badge autonomous running background. Autonomous-room state badge colors |
| `--qt-badge-autonomous-running-fg` | color | `var(--qt-status-success-fg)` |  |  | advanced | Badge autonomous running text colour |
| `--qt-badge-autonomous-running-border` | color | `var(--qt-status-success-border)` |  |  | advanced | Badge autonomous running border |
| `--qt-badge-autonomous-idle-bg` | color | `var(--qt-status-info-bg)` |  |  | advanced | Badge autonomous idle background |
| `--qt-badge-autonomous-idle-fg` | color | `var(--qt-status-info-fg)` |  |  | advanced | Badge autonomous idle text colour |
| `--qt-badge-autonomous-idle-border` | color | `var(--qt-status-info-border)` |  |  | advanced | Badge autonomous idle border |
| `--qt-badge-autonomous-paused-bg` | color | `var(--qt-status-warning-bg)` |  |  | advanced | Badge autonomous paused background |
| `--qt-badge-autonomous-paused-fg` | color | `var(--qt-status-warning-fg)` |  |  | advanced | Badge autonomous paused text colour |
| `--qt-badge-autonomous-paused-border` | color | `var(--qt-status-warning-border)` |  |  | advanced | Badge autonomous paused border |
| `--qt-badge-autonomous-stopped-bg` | color | `var(--color-muted)` |  |  | advanced | Badge autonomous stopped background |
| `--qt-badge-autonomous-stopped-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Badge autonomous stopped text colour |
| `--qt-badge-autonomous-stopped-border` | color | `var(--color-border)` |  |  | advanced | Badge autonomous stopped border |
| `--qt-badge-autonomous-budget-bg` | color | `var(--qt-badge-related-bg)` |  |  | advanced | Badge autonomous budget background |
| `--qt-badge-autonomous-budget-fg` | color | `var(--qt-badge-related-fg)` |  |  | advanced | Badge autonomous budget text colour |
| `--qt-badge-autonomous-budget-border` | color | `color-mix(in srgb, var(--qt-badge-related-fg) 45%, transparent)` | `color-mix(in srgb, var(--qt-badge-related-fg) 50%, transparent)` |  | advanced | Badge autonomous budget border |
| `--qt-badge-autonomous-error-bg` | color | `var(--qt-status-danger-bg)` |  |  | advanced | Badge autonomous error background |
| `--qt-badge-autonomous-error-fg` | color | `var(--qt-status-danger-fg)` |  |  | advanced | Badge autonomous error text colour |
| `--qt-badge-autonomous-error-border` | color | `var(--qt-status-danger-border)` |  |  | advanced | Badge autonomous error border |
| `--qt-queue-badge-radius` | radius | `var(--radius-sm)` |  |  | advanced | Queue badge radius. Queue status badge colors |
| `--qt-queue-badge-padding-x` | length | `0.375rem` |  |  | advanced | Queue badge horizontal padding |
| `--qt-queue-badge-padding-y` | length | `0.125rem` |  |  | advanced | Queue badge vertical padding |
| `--qt-queue-badge-font-size` | length | `0.6875rem` |  |  | advanced | Queue badge font size |
| `--qt-queue-badge-font-weight` | font-weight | `600` |  |  | advanced | Queue badge font weight |
| `--qt-queue-badge-group-gap` | length | `1px` |  |  | advanced | Queue badge group gap |
| `--qt-queue-badge-group-radius` | radius | `var(--radius-md)` |  |  | advanced | Queue badge group radius |
| `--qt-queue-badge-memory-bg` | color | `hsl(225 55% 48%)` | `hsl(225 55% 55%)` |  | standard | Queue badge memory background |
| `--qt-queue-badge-memory-fg` | color | `hsl(0 0% 100%)` |  |  | standard | Queue badge memory text colour |
| `--qt-queue-badge-embedding-bg` | color | `hsl(270 50% 48%)` | `hsl(270 50% 55%)` |  | standard | Queue badge embedding background |
| `--qt-queue-badge-embedding-fg` | color | `hsl(0 0% 100%)` |  |  | standard | Queue badge embedding text colour |
| `--qt-queue-badge-summary-bg` | color | `hsl(152 55% 33.5%)` | `hsl(152 50% 34.5%)` |  | standard | Queue badge summary background |
| `--qt-queue-badge-summary-fg` | color | `hsl(0 0% 100%)` |  |  | advanced | Queue badge summary text colour |
| `--qt-queue-badge-danger-bg` | color | `hsl(0 60% 48%)` | `hsl(0 60% 52%)` |  | standard | Queue badge danger background |
| `--qt-queue-badge-danger-fg` | color | `hsl(0 0% 100%)` |  |  | advanced | Queue badge danger text colour |
| `--qt-queue-badge-story-bg` | color | `hsl(225 12% 38%)` | `hsl(225 12% 44%)` |  | standard | Queue badge story background |
| `--qt-queue-badge-story-fg` | color | `hsl(0 0% 100%)` |  |  | standard | Queue badge story text colour |
| `--qt-queue-badge-idle-opacity` | opacity | `0.35` |  | density=comfortable: `0.4` | standard | Queue badge idle tint (share of the badge colour) |
| `--qt-autonomous-badge-running-bg` | color | `hsl(152 55% 38%)` |  |  | advanced | Autonomous badge running background. Autonomous-room badge colors (shares queue-badge structural tokens) |
| `--qt-autonomous-badge-running-fg` | color | `hsl(0 0% 100%)` |  |  | advanced | Autonomous badge running text colour |
| `--qt-autonomous-badge-idle-bg` | color | `hsl(225 12% 38%)` |  |  | advanced | Autonomous badge idle background |
| `--qt-autonomous-badge-idle-fg` | color | `hsl(0 0% 100%)` |  |  | advanced | Autonomous badge idle text colour |
| `--qt-autonomous-badge-button-hover-bg` | color | `hsl(0 0% 100% / 0.18)` |  |  | advanced | Autonomous badge button hover background |

## Avatar

Group id `avatar`, 8 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-avatar-radius` | radius | `9999px` |  |  | standard | Avatar radius |
| `--qt-avatar-size` | length | `2.25rem` |  | density=comfortable: `2.5rem` | standard | Avatar size |
| `--qt-avatar-size-sm` | length | `1.75rem` |  | density=comfortable: `2rem` | standard | Avatar size small |
| `--qt-avatar-size-lg` | length | `2.75rem` |  | density=comfortable: `3rem` | standard | Avatar size large |
| `--qt-avatar-size-xl` | length | `3.5rem` |  | density=comfortable: `4rem` | standard | Avatar size extra large |
| `--qt-avatar-bg` | color | `var(--color-muted)` |  |  | advanced | Avatar background |
| `--qt-avatar-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Avatar text colour |
| `--qt-avatar-border` | color | `var(--color-border)` |  |  | standard | Avatar border |

## Code block

Group id `code-block`, 22 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-code-radius` | radius | `var(--radius-md)` |  |  | advanced | Code radius |
| `--qt-code-bg` | color | `var(--color-muted)` |  |  | advanced | Code background |
| `--qt-code-fg` | color | `var(--color-foreground)` |  |  | advanced | Code text colour |
| `--qt-code-border` | color | `var(--color-border)` |  |  | advanced | Code border |
| `--qt-code-font` | font-family | `var(--font-mono)` |  |  | standard | Code font |
| `--qt-code-token-comment` | color | `color-mix(in srgb, var(--qt-code-fg) 78%, var(--qt-code-bg))` |  |  | advanced | Code comment. Comments in highlighted source (the theme editor's CSS, JSON files in Document Mode). |
| `--qt-code-token-keyword` | color | `color-mix(in srgb, var(--qt-code-fg) 68%, #d0105a)` |  |  | advanced | Code keyword. At-rules, `!important`, `true` / `false` / `null`. |
| `--qt-code-token-string` | color | `color-mix(in srgb, var(--qt-code-fg) 68%, #189040)` |  |  | advanced | Code string. Strings and `url()` values. |
| `--qt-code-token-number` | color | `color-mix(in srgb, var(--qt-code-fg) 68%, #1a6fe0)` |  |  | advanced | Code number. Numbers, lengths and hex colours. |
| `--qt-code-token-property` | color | `color-mix(in srgb, var(--qt-code-fg) 68%, #9040e0)` |  |  | advanced | Code property. CSS property names and JSON keys. |
| `--qt-code-token-selector` | color | `color-mix(in srgb, var(--qt-code-fg) 68%, #c06000)` |  |  | advanced | Code selector. CSS selectors. |
| `--qt-code-token-function` | color | `color-mix(in srgb, var(--qt-code-fg) 68%, #0090b0)` |  |  | advanced | Code function. CSS functions such as `var()` and `calc()`. |
| `--qt-code-token-punctuation` | color | `var(--qt-code-fg)` |  |  | advanced | Code punctuation. Braces, colons, commas and semicolons. |
| `--qt-copy-button-bg` | color | `rgba(0, 0, 0, 0.6)` |  |  | advanced | Copy button background. Hook: _content.css reads it as var(--qt-copy-button-bg, rgba(0, 0, 0, 0.6)); the default is that fallback. |
| `--qt-copy-button-text` | color | `rgba(255, 255, 255, 0.9)` |  |  | advanced | Copy button text. Hook: _content.css reads it as var(--qt-copy-button-text, rgba(255, 255, 255, 0.9)); the default is that fallback. |
| `--qt-copy-button-border` | color | `rgba(255, 255, 255, 0.1)` |  |  | advanced | Copy button border. Hook: _content.css reads it as var(--qt-copy-button-border, rgba(255, 255, 255, 0.1)); the default is that fallback. |
| `--qt-copy-button-hover-bg` | color | `rgba(0, 0, 0, 0.8)` |  |  | advanced | Copy button hover background. Hook: _content.css reads it as var(--qt-copy-button-hover-bg, rgba(0, 0, 0, 0.8)); the default is that fallback. |
| `--qt-copy-button-hover-text` | color | `#fff` |  |  | advanced | Copy button hover text. Hook: _content.css reads it as var(--qt-copy-button-hover-text, #fff); the default is that fallback. |
| `--qt-copy-button-hover-border` | color | `rgba(255, 255, 255, 0.2)` |  |  | advanced | Copy button hover border. Hook: _content.css reads it as var(--qt-copy-button-hover-border, rgba(255, 255, 255, 0.2)); the default is that fallback. |
| `--qt-copy-button-success-bg` | color | `rgba(34, 197, 94, 0.8)` |  |  | advanced | Copy button success background. Hook: _content.css reads it as var(--qt-copy-button-success-bg, rgba(34, 197, 94, 0.8)); the default is that fallback. |
| `--qt-copy-button-success-text` | color | `#fff` |  |  | advanced | Copy button success text. Hook: _content.css reads it as var(--qt-copy-button-success-text, #fff); the default is that fallback. |
| `--qt-copy-button-success-border` | color | `rgba(34, 197, 94, 0.5)` |  |  | advanced | Copy button success border. Hook: _content.css reads it as var(--qt-copy-button-success-border, rgba(34, 197, 94, 0.5)); the default is that fallback. |

## Diagram

Group id `diagram`, 20 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-diagram-radius` | radius | `var(--radius-md)` |  |  | advanced | Diagram radius |
| `--qt-diagram-bg` | color | `var(--color-card)` |  |  | advanced | Diagram background |
| `--qt-diagram-fg` | color | `var(--color-foreground)` |  |  | advanced | Diagram text colour |
| `--qt-diagram-border` | color | `var(--color-border)` |  |  | advanced | Diagram border |
| `--qt-diagram-muted-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Diagram muted text colour |
| `--qt-diagram-toolbar-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Diagram toolbar text colour |
| `--qt-diagram-toolbar-hover-bg` | color | `var(--color-muted)` |  |  | advanced | Diagram toolbar hover background |
| `--qt-diagram-error-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Diagram error text colour |
| `--qt-diagram-placeholder-height` | length | `8rem` |  |  | advanced | Diagram placeholder height |
| `--qt-diagram-font` | font-family | `var(--font-sans)` |  |  | advanced | Diagram font. The face diagrams are lettered in, and the hand a hand-drawn one is lettered in (Mermaid's hand-drawn look and sketched Graphviz alike). |
| `--qt-diagram-hand-font` | font-family | `"Segoe Print", "Bradley Hand", "Chalkboard SE", "Marker Felt", cursive` |  |  | advanced | Diagram hand font |
| `--qt-diagram-lightbox-backdrop` | color | `var(--qt-overlay-bg)` |  |  | advanced | Diagram lightbox backdrop. The lightbox: the overlay's backdrop and glass buttons, a lifted sheet, and the checkerboard behind a transparent copy. |
| `--qt-diagram-lightbox-fg` | color | `var(--qt-overlay-fg)` |  |  | advanced | Diagram lightbox text colour |
| `--qt-diagram-lightbox-muted-fg` | color | `var(--qt-overlay-muted-fg)` |  |  | advanced | Diagram lightbox muted text colour |
| `--qt-diagram-lightbox-button-bg` | color | `var(--qt-overlay-btn-bg)` |  |  | advanced | Diagram lightbox button background |
| `--qt-diagram-lightbox-button-hover-bg` | color | `var(--qt-overlay-btn-hover-bg)` |  |  | advanced | Diagram lightbox button hover background |
| `--qt-diagram-lightbox-pressed-border` | color | `var(--qt-overlay-muted-fg)` |  |  | advanced | Diagram lightbox pressed border |
| `--qt-diagram-lightbox-shadow` | shadow | `0 10px 40px rgb(0 0 0 / 0.45)` |  |  | advanced | Diagram lightbox shadow |
| `--qt-diagram-lightbox-check-a` | color | `#ffffff` |  |  | advanced | Diagram lightbox check a |
| `--qt-diagram-lightbox-check-b` | color | `#d4d4d8` |  |  | advanced | Diagram lightbox check b |

## Link

Group id `link`, 4 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-link-color` | color | `var(--color-primary)` |  |  | standard | Link color |
| `--qt-link-hover-color` | color | `color-mix(in srgb, var(--color-primary) 80%, var(--theme-hover-shade))` |  |  | standard | Link hover color |
| `--qt-link-decoration` | keyword | `none` |  |  | standard | Link decoration One of: `none`, `underline`, `overline`, `line-through`. |
| `--qt-link-decoration-hover` | keyword | `underline` |  |  | advanced | Link decoration hover One of: `none`, `underline`, `overline`, `line-through`. |

## Footer

Group id `footer`, 3 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-footer-border` | color | `var(--color-border)` |  |  | advanced | Footer border |
| `--qt-footer-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Footer text colour |
| `--qt-footer-link-hover` | color | `var(--color-primary)` |  |  | standard | Footer link hover |

## Brand

Group id `brand`, 1 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-brand-fg` | color | `var(--color-foreground)` |  |  | standard | Brand text colour |

## Auth page

Group id `auth-page`, 8 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-auth-card-bg` | color | `var(--color-card)` |  |  | advanced | Auth card background |
| `--qt-auth-card-fg` | color | `var(--color-card-foreground)` |  |  | advanced | Auth card text colour |
| `--qt-auth-title-fg` | color | `var(--color-foreground)` |  |  | standard | Auth title text colour |
| `--qt-auth-subtitle-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Auth subtitle text colour |
| `--qt-auth-label-fg` | color | `var(--color-foreground)` |  |  | advanced | Auth label text colour |
| `--qt-auth-hint-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Auth hint text colour |
| `--qt-auth-footer-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Auth footer text colour |
| `--qt-auth-divider-color` | color | `var(--color-border)` |  |  | advanced | Auth divider color |

## Highlight (search result highlighting)

Group id `highlight`, 5 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-highlight-bg` | color | `hsl(48 100% 50%)` |  |  | standard | Highlight background |
| `--qt-highlight-fg` | color | `hsl(40 100% 10%)` |  |  | standard | Highlight text colour |
| `--qt-highlight-radius` | radius | `0.125rem` |  |  | advanced | Highlight radius |
| `--qt-highlight-padding-x` | length | `0.125rem` |  |  | advanced | Highlight horizontal padding |
| `--qt-highlight-font-weight` | font-weight | `500` |  |  | advanced | Highlight font weight |

## Overlay

Group id `overlay`, 8 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-overlay-bg` | color | `color-mix(in srgb, var(--theme-scrim) var(--theme-scrim-strength), transparent)` |  |  | standard | Overlay background |
| `--qt-overlay-medium-bg` | color | `color-mix(in srgb, var(--theme-scrim) 60%, transparent)` |  |  | standard | Overlay medium background |
| `--qt-overlay-light-bg` | color | `color-mix(in srgb, var(--theme-scrim) 20%, transparent)` |  |  | standard | Overlay light background |
| `--qt-overlay-caption-bg` | color | `color-mix(in srgb, var(--theme-scrim) 50%, transparent)` |  |  | standard | Overlay caption background |
| `--qt-overlay-btn-bg` | color | `color-mix(in srgb, var(--theme-scrim-foreground) 10%, transparent)` |  |  | standard | Overlay button background |
| `--qt-overlay-btn-hover-bg` | color | `color-mix(in srgb, var(--theme-scrim-foreground) 20%, transparent)` |  |  | standard | Overlay button hover background |
| `--qt-overlay-fg` | color | `var(--theme-scrim-foreground)` |  |  | standard | Overlay text colour |
| `--qt-overlay-muted-fg` | color | `color-mix(in srgb, var(--theme-scrim-foreground) 70%, transparent)` |  |  | standard | Overlay muted text colour |

## Spinner

Group id `spinner`, 2 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-spinner-track` | color | `color-mix(in srgb, var(--color-primary) 20%, transparent)` |  |  | standard | Spinner track |
| `--qt-spinner-indicator` | color | `var(--color-primary)` |  |  | standard | Spinner indicator |

## Progress bar

Group id `progress-bar`, 4 tokens.

Every bar-shaped construct in the app — task progress, value meters — draws its track and fill from these two. A caller wanting a bespoke fill colour (Pascal's per-outcome meters) sets --qt-progress-indicator inline rather than reaching for a raw background utility.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-progress-track` | color | `var(--color-muted)` |  |  | advanced | Progress track |
| `--qt-progress-indicator` | color | `var(--color-primary)` |  |  | advanced | Progress indicator |
| `--qt-progress-indicator-success` | color | `var(--color-success)` |  |  | advanced | Progress indicator success |
| `--qt-progress-indicator-danger` | color | `var(--color-destructive)` |  |  | advanced | Progress indicator danger |

## Favorite

Group id `favorite`, 1 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-favorite-color` | color | `hsl(45 96% 58%)` |  |  | standard | Favorite color |

## Toggle

Group id `toggle`, 1 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-toggle-knob-bg` | color | `white` |  |  | standard | Toggle knob background |

## Warning box

Group id `warning-box`, 3 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-warning-box-bg` | color | `color-mix(in srgb, var(--color-warning) 8%, transparent)` |  |  | standard | Warning box background |
| `--qt-warning-box-border` | color | `color-mix(in srgb, var(--color-warning) 30%, transparent)` |  |  | standard | Warning box border |
| `--qt-warning-box-fg` | color | `var(--color-warning)` |  |  | standard | Warning box text colour |

## Filter chip

Group id `filter-chip`, 13 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-filter-chip-radius` | radius | `9999px` |  |  | standard | Filter chip radius |
| `--qt-filter-chip-padding-x` | length | `0.5rem` |  |  | advanced | Filter chip horizontal padding |
| `--qt-filter-chip-padding-y` | length | `0.1875rem` |  | density=comfortable: `0.25rem` | standard | Filter chip vertical padding |
| `--qt-filter-chip-font-size` | length | `0.75rem` |  |  | advanced | Filter chip font size |
| `--qt-filter-chip-font-weight` | font-weight | `500` |  |  | advanced | Filter chip font weight |
| `--qt-filter-chip-transition` | transition | `all 150ms ease` |  |  | advanced | Filter chip transition |
| `--qt-filter-chip-active-bg` | color | `var(--color-primary)` |  |  | advanced | Filter chip active background |
| `--qt-filter-chip-active-fg` | color | `var(--color-primary-foreground)` |  |  | advanced | Filter chip active text colour |
| `--qt-filter-chip-active-border` | color | `transparent` |  |  | advanced | Filter chip active border |
| `--qt-filter-chip-inactive-bg` | color | `var(--color-muted)` |  |  | advanced | Filter chip inactive background |
| `--qt-filter-chip-inactive-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Filter chip inactive text colour |
| `--qt-filter-chip-inactive-border` | color | `transparent` |  |  | advanced | Filter chip inactive border |
| `--qt-filter-chip-inactive-hover-bg` | color | `color-mix(in srgb, var(--color-muted) 82%, var(--theme-hover-tint) 4%)` |  |  | standard | Filter chip inactive hover background |

## Tab

Group id `tab`, 16 tokens.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-tab-radius` | radius | `var(--radius-md) var(--radius-md) 0 0` |  |  | standard | Tab radius |
| `--qt-tab-padding-x` | length | `0.875rem` |  | density=comfortable: `1rem` | standard | Tab horizontal padding |
| `--qt-tab-padding-y` | length | `0.5rem` |  | density=comfortable: `0.625rem` | standard | Tab vertical padding |
| `--qt-tab-font-size` | length | `0.8125rem` |  |  | standard | Tab font size |
| `--qt-tab-font-weight` | font-weight | `500` |  |  | advanced | Tab font weight |
| `--qt-tab-transition` | transition | `all 150ms cubic-bezier(0.4, 0, 0.2, 1)` |  |  | advanced | Tab transition |
| `--qt-tab-bg` | color | `var(--color-muted)` |  |  | advanced | Tab background |
| `--qt-tab-fg` | color | `var(--color-muted-foreground)` |  |  | advanced | Tab text colour |
| `--qt-tab-border` | color | `transparent` |  |  | advanced | Tab border |
| `--qt-tab-hover-bg` | color | `color-mix(in srgb, var(--color-muted) 82%, var(--theme-hover-tint) 4%)` |  |  | standard | Tab hover background |
| `--qt-tab-hover-fg` | color | `var(--color-foreground)` |  |  | advanced | Tab hover text colour |
| `--qt-tab-active-bg` | color | `var(--color-card)` |  |  | advanced | Tab active background |
| `--qt-tab-active-fg` | color | `var(--color-primary)` |  |  | standard | Tab active text colour |
| `--qt-tab-active-border` | color | `var(--color-border)` |  |  | advanced | Tab active border |
| `--qt-tab-group-gap` | length | `0.1875rem` |  |  | standard | Tab group gap |
| `--qt-tab-divider-color` | color | `var(--color-border)` |  |  | advanced | Tab divider color |

## Workspace

Group id `workspace`, 2 tokens.

The tabbed workspace (_workspace.css). These are read there as hooks with a fallback; the registry declares them so they are listed.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-workspace-accent` | color | `var(--color-primary)` |  |  | standard | Workspace accent. Hook: _workspace.css reads it as var(--qt-workspace-accent, var(--color-primary)); the default is that fallback. |
| `--qt-workspace-tab-active-fg` | color | `var(--color-foreground)` |  |  | advanced | Workspace tab active text colour. Hook: _workspace.css reads it as var(--qt-workspace-tab-active-fg, var(--color-foreground)); the default is that fallback. |

## Terminal

Group id `terminal`, 30 tokens.

Terminals carry a "terminal" identity regardless of the surrounding theme's light/dark mode (so a parchment theme can still render a dark terminal pane). Themes may override these in their own block.

| Token | Type | Default | Dark default | By choice | Visibility | What it is |
| --- | --- | --- | --- | --- | --- | --- |
| `--qt-terminal-bg` | color | `var(--theme-terminal-background)` |  |  | standard | Terminal background |
| `--qt-terminal-fg` | color | `var(--theme-terminal-foreground)` |  |  | standard | Terminal text colour |
| `--qt-terminal-cursor` | color | `var(--theme-terminal-cursor)` |  |  | standard | Terminal cursor |
| `--qt-terminal-selection` | color | `var(--theme-terminal-selection)` |  |  | standard | Terminal selection |
| `--qt-terminal-ansi-black` | color | `var(--theme-terminal-ansi-black)` |  |  | standard | Terminal ANSI black. Optional terminal knobs, deliberately left undefined. xterm derives each from --qt-terminal-bg / --qt-terminal-fg when unset (slider colors default to the foreground at 20/40/50% opacity), which already tracks the theme. A theme only needs to set one to override that derivation: --qt-terminal-cursor-accent      text color under a block cursor --qt-terminal-selection-fg       text color inside a selection --qt-terminal-selection-inactive selection while the pane is unfocused --qt-terminal-scrollbar          scrollbar slider --qt-terminal-scrollbar-hover    scrollbar slider, hovered --qt-terminal-scrollbar-active   scrollbar slider, dragged |
| `--qt-terminal-ansi-red` | color | `var(--theme-terminal-ansi-red)` |  |  | standard | Terminal ANSI red |
| `--qt-terminal-ansi-green` | color | `var(--theme-terminal-ansi-green)` |  |  | standard | Terminal ANSI green |
| `--qt-terminal-ansi-yellow` | color | `var(--theme-terminal-ansi-yellow)` |  |  | standard | Terminal ANSI yellow |
| `--qt-terminal-ansi-blue` | color | `var(--theme-terminal-ansi-blue)` |  |  | standard | Terminal ANSI blue |
| `--qt-terminal-ansi-magenta` | color | `var(--theme-terminal-ansi-magenta)` |  |  | standard | Terminal ANSI magenta |
| `--qt-terminal-ansi-cyan` | color | `var(--theme-terminal-ansi-cyan)` |  |  | standard | Terminal ANSI cyan |
| `--qt-terminal-ansi-white` | color | `var(--theme-terminal-ansi-white)` |  |  | standard | Terminal ANSI white |
| `--qt-terminal-ansi-bright-black` | color | `var(--theme-terminal-ansi-bright-black)` |  |  | standard | Terminal ANSI bright black |
| `--qt-terminal-ansi-bright-red` | color | `var(--theme-terminal-ansi-bright-red)` |  |  | standard | Terminal ANSI bright red |
| `--qt-terminal-ansi-bright-green` | color | `var(--theme-terminal-ansi-bright-green)` |  |  | standard | Terminal ANSI bright green |
| `--qt-terminal-ansi-bright-yellow` | color | `var(--theme-terminal-ansi-bright-yellow)` |  |  | standard | Terminal ANSI bright yellow |
| `--qt-terminal-ansi-bright-blue` | color | `var(--theme-terminal-ansi-bright-blue)` |  |  | standard | Terminal ANSI bright blue |
| `--qt-terminal-ansi-bright-magenta` | color | `var(--theme-terminal-ansi-bright-magenta)` |  |  | standard | Terminal ANSI bright magenta |
| `--qt-terminal-ansi-bright-cyan` | color | `var(--theme-terminal-ansi-bright-cyan)` |  |  | standard | Terminal ANSI bright cyan |
| `--qt-terminal-ansi-bright-white` | color | `var(--theme-terminal-ansi-bright-white)` |  |  | standard | Terminal ANSI bright white |
| `--qt-terminal-chrome-bg` | color | `color-mix(in srgb, var(--qt-terminal-bg) 78%, var(--qt-terminal-fg) 6%)` |  |  | standard | Terminal chrome background. Terminal chrome (pop-out page, in-chat embed) |
| `--qt-terminal-chrome-border` | color | `color-mix(in srgb, var(--qt-terminal-bg) 55%, var(--qt-terminal-fg) 22%)` |  |  | standard | Terminal chrome border |
| `--qt-terminal-chrome-fg` | color | `var(--qt-terminal-fg)` |  |  | standard | Terminal chrome text colour |
| `--qt-terminal-chrome-muted-fg` | color | `color-mix(in srgb, var(--qt-terminal-fg) 55%, transparent)` |  |  | standard | Terminal chrome muted text colour |
| `--qt-terminal-closed-badge-bg` | color | `color-mix(in srgb, var(--qt-terminal-bg) 50%, var(--qt-terminal-fg) 18%)` |  |  | standard | Terminal closed badge background |
| `--qt-terminal-closed-badge-fg` | color | `var(--qt-terminal-fg)` |  |  | standard | Terminal closed badge text colour |
| `--qt-terminal-embed-bg` | color | `var(--color-card)` |  |  | advanced | Terminal embed background. In-chat terminal embed wrapper (uses surrounding theme so it nests with chat bubbles) |
| `--qt-terminal-embed-border` | color | `var(--color-border)` |  |  | advanced | Terminal embed border |
| `--qt-terminal-embed-header-bg` | color | `var(--color-muted)` |  |  | advanced | Terminal embed header background |
| `--qt-terminal-embed-header-border` | color | `var(--color-border)` |  |  | advanced | Terminal embed header border |
