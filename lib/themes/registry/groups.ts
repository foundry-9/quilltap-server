/**
 * Theme token registry — the groups, in the order the generated CSS emits them.
 *
 * One file per group under ./groups/. The order here is the declaration order
 * in the generated sheet each group belongs to (`sheet`): app/styles/_theme-defaults.css
 * for the semantic groups, app/styles/qt-components/_variables.css for the rest.
 */

import type { TokenGroupDef } from './types';
import { COLORS_TOKENS } from './groups/colors';
import { SIDEBAR_COLORS_TOKENS } from './groups/sidebar-colors';
import { RADIUS_TOKENS } from './groups/radius';
import { TYPE_SCALE_TOKENS } from './groups/type-scale';
import { SPACING_TOKENS } from './groups/spacing';
import { EFFECTS_TOKENS } from './groups/effects';
import { CATEGORY_TOKENS } from './groups/category';
import { STATUS_PALETTE_TOKENS } from './groups/status-palette';
import { CHAT_SURFACES_TOKENS } from './groups/chat-surfaces';
import { ROLEPLAY_TEXT_TOKENS } from './groups/roleplay-text';
import { TERMINAL_PALETTE_TOKENS } from './groups/terminal-palette';
import { OVERLAY_SCRIM_TOKENS } from './groups/overlay-scrim';
import { INTERACTION_TOKENS } from './groups/interaction';
import { FONTS_TOKENS } from './groups/fonts';
import { BUTTON_TOKENS } from './groups/button';
import { STATUS_TOKENS } from './groups/status';
import { ALERT_TOKENS } from './groups/alert';
import { CARD_TOKENS } from './groups/card';
import { INPUT_TOKENS } from './groups/input';
import { CHECKBOX_RADIO_TOKENS } from './groups/checkbox-radio';
import { RANGE_TOKENS } from './groups/range';
import { NAVBAR_TOKENS } from './groups/navbar';
import { PAGE_TOKENS } from './groups/page';
import { CONTENT_AREA_TOKENS } from './groups/content-area';
import { TYPOGRAPHY_TOKENS } from './groups/typography';
import { SIDEBAR_TOKENS } from './groups/sidebar';
import { LEFT_SIDEBAR_TOKENS } from './groups/left-sidebar';
import { APP_HEADER_TOKENS } from './groups/app-header';
import { PANEL_DIALOG_POPOVER_TOKENS } from './groups/panel-dialog-popover';
import { CHAT_TOKENS } from './groups/chat';
import { ROLEPLAY_ANNOTATION_TOKENS } from './groups/roleplay-annotation';
import { BADGE_TOKENS } from './groups/badge';
import { AVATAR_TOKENS } from './groups/avatar';
import { CODE_BLOCK_TOKENS } from './groups/code-block';
import { DIAGRAM_TOKENS } from './groups/diagram';
import { LINK_TOKENS } from './groups/link';
import { FOOTER_TOKENS } from './groups/footer';
import { BRAND_TOKENS } from './groups/brand';
import { AUTH_PAGE_TOKENS } from './groups/auth-page';
import { HIGHLIGHT_TOKENS } from './groups/highlight';
import { OVERLAY_TOKENS } from './groups/overlay';
import { SPINNER_TOKENS } from './groups/spinner';
import { PROGRESS_BAR_TOKENS } from './groups/progress-bar';
import { FAVORITE_TOKENS } from './groups/favorite';
import { TOGGLE_TOKENS } from './groups/toggle';
import { WARNING_BOX_TOKENS } from './groups/warning-box';
import { FILTER_CHIP_TOKENS } from './groups/filter-chip';
import { TAB_TOKENS } from './groups/tab';
import { WORKSPACE_TOKENS } from './groups/workspace';
import { TERMINAL_TOKENS } from './groups/terminal';

export const TOKEN_GROUPS: readonly TokenGroupDef[] = [
  // Semantic tier: generated into app/styles/_theme-defaults.css
  { id: 'colors', label: "Colours", sheet: 'theme-defaults', description: "The semantic colour pairs every component derives from: surfaces, text, actions, status, borders. Each X has an X-foreground meant to read on it. Tailwind maps each to a --color-* utility (app/styles/theme-tokens.css).", tokens: COLORS_TOKENS },
  { id: 'sidebar-colors', label: "Sidebar colours", sheet: 'theme-defaults', description: "The navigation sidebar's own palette, mapped to --color-sidebar-* utilities.", tokens: SIDEBAR_COLORS_TOKENS },
  { id: 'radius', label: "Corner radii", sheet: 'theme-defaults', description: "The radius scale. Tailwind maps sm / md / lg to --radius-*; components read those.", tokens: RADIUS_TOKENS },
  { id: 'type-scale', label: "Type scale", sheet: 'theme-defaults', description: "Font sizes, line heights, weights and letter spacing.", tokens: TYPE_SCALE_TOKENS },
  { id: 'spacing', label: "Spacing scale", sheet: 'theme-defaults', description: "The spacing steps.", tokens: SPACING_TOKENS },
  { id: 'effects', label: "Effects", sheet: 'theme-defaults', description: "Shadows, transition timing and the focus ring.", tokens: EFFECTS_TOKENS },
  { id: 'category', label: "Category palette", sheet: 'theme-defaults', description: "One colour per category of thing a badge labels, with the text colour that reads on its tint. Badge backgrounds are the category colour at the tint strength; badge text is the category foreground.", tokens: CATEGORY_TOKENS },
  { id: 'status-palette', label: "Status palette", sheet: 'theme-defaults', description: "The colours of alerts and notices: one colour per status, shown at a fill strength for the background and an edge strength for the border, with a text colour of its own. These are lighter than the action colours (--theme-success and friends), which buttons and solid status badges use.", tokens: STATUS_PALETTE_TOKENS },
  { id: 'chat-surfaces', label: "Chat surfaces", sheet: 'theme-defaults', description: "The Salon's message surfaces. The user bubble is --theme-chat-user (Colours); the assistant surface and text are here, and each special message kind (whisper, silent, wardrobe notice) is the assistant surface mixed with that kind's accent, labelled in its foreground.", tokens: CHAT_SURFACES_TOKENS },
  { id: 'roleplay-text', label: "Roleplay text", sheet: 'theme-defaults', description: "How a roleplay template's annotations look: dialogue, narration, inner monologue and out-of-character asides each have a surface and a text colour; the four template chips (qt-roleplay-1..4) have a colour and a foreground. The insert buttons (--qt-rp-button-*) stay component tokens.", tokens: ROLEPLAY_TEXT_TOKENS },
  { id: 'terminal-palette', label: "Terminal palette", sheet: 'theme-defaults', description: "Ariel's terminal: background, text, cursor, selection and the sixteen ANSI colours. A terminal keeps its own identity whatever the theme's mode, so these have no dark values of their own.", tokens: TERMINAL_PALETTE_TOKENS },
  { id: 'overlay-scrim', label: "Overlay scrim", sheet: 'theme-defaults', description: "The dark layer behind lightboxes, image viewers and dialogs, and the text and glass buttons on it. Every overlay is the scrim colour at some strength; --theme-scrim-strength sets the full-screen one.", tokens: OVERLAY_SCRIM_TOKENS },
  { id: 'interaction', label: "Interaction states", sheet: 'theme-defaults', description: "What hovering does. A solid fill (a primary or destructive button, a link) mixes toward the shade; a quiet surface (a tab, a filter chip) mixes in a little of the tint. Each component keeps its own share, so a theme changes the direction here and the amount per component.", tokens: INTERACTION_TOKENS },
  // Component tier (and the font stacks): generated into app/styles/qt-components/_variables.css
  { id: 'fonts', label: "Font stacks", description: "System fonts only, the best default on each OS. These five are the semantic tier's type tokens.", tokens: FONTS_TOKENS },
  { id: 'button', label: "Button", tokens: BUTTON_TOKENS },
  { id: 'status', label: "Status", description: "Backgrounds are the status colour at full strength: each X / XForeground token pair is held to 4.5:1, and the old 85% mix let the page show through and dropped white-on-colour badges to ~3.7:1 (WCAG 1.4.3).", tokens: STATUS_TOKENS },
  { id: 'alert', label: "Alert", tokens: ALERT_TOKENS },
  { id: 'card', label: "Card", description: "Restrained shadows — visible but never showy. Tighter radii.", tokens: CARD_TOKENS },
  { id: 'input', label: "Input", tokens: INPUT_TOKENS },
  { id: 'checkbox-radio', label: "Checkbox and radio", description: "accent-color is the real theming hook for native controls (the fill/check); the border/size/radius tokens take effect for appearance:none themes.", tokens: CHECKBOX_RADIO_TOKENS },
  { id: 'range', label: "Range (slider)", description: "Sliders stay natively rendered on purpose. accent-color is what paints the filled portion of the track *and* the thumb, in every engine we target, so it is the whole theming story for the default look. Do NOT \"improve\" this into `appearance: none` with a custom ::-webkit-slider-runnable-track / ::-webkit-slider-thumb pair: appearance:none discards the filled bar in Chrome and Safari (Firefox alone keeps it, via ::-moz-range-progress), so a hand-built track trades the value affordance for styling reach and looks different per browser. A theme that genuinely wants a bespoke slider can still opt in by overriding .qt-range itself.", tokens: RANGE_TOKENS },
  { id: 'navbar', label: "Navbar", tokens: NAVBAR_TOKENS },
  { id: 'page', label: "Page", description: "App-owned rules on the root: colour scheme, text selection, scrollbars, the focus ring and an optional page background image. They live in _base.css in cascade layers (or, for the page background, behind an attribute), so a theme's own unlayered rules still win.", tokens: PAGE_TOKENS },
  { id: 'content-area', label: "Content area", tokens: CONTENT_AREA_TOKENS },
  { id: 'typography', label: "Typography", tokens: TYPOGRAPHY_TOKENS },
  { id: 'sidebar', label: "Sidebar", tokens: SIDEBAR_TOKENS },
  { id: 'left-sidebar', label: "Left sidebar (app navigation)", tokens: LEFT_SIDEBAR_TOKENS },
  { id: 'app-header', label: "App header", tokens: APP_HEADER_TOKENS },
  { id: 'panel-dialog-popover', label: "Panel, dialog and popover", tokens: PANEL_DIALOG_POPOVER_TOKENS },
  { id: 'chat', label: "Chat", description: "Sans-serif throughout — no serif in assistant messages. The user bubble matches the primary hue for brand cohesion.", tokens: CHAT_TOKENS },
  { id: 'roleplay-annotation', label: "Roleplay annotation", description: "Subdued — this theme is for power users, not immersive RP. Annotations are functional, not atmospheric.", tokens: ROLEPLAY_ANNOTATION_TOKENS },
  { id: 'badge', label: "Badge", tokens: BADGE_TOKENS },
  { id: 'avatar', label: "Avatar", tokens: AVATAR_TOKENS },
  { id: 'code-block', label: "Code block", tokens: CODE_BLOCK_TOKENS },
  { id: 'diagram', label: "Diagram", tokens: DIAGRAM_TOKENS },
  { id: 'link', label: "Link", tokens: LINK_TOKENS },
  { id: 'footer', label: "Footer", tokens: FOOTER_TOKENS },
  { id: 'brand', label: "Brand", tokens: BRAND_TOKENS },
  { id: 'auth-page', label: "Auth page", tokens: AUTH_PAGE_TOKENS },
  { id: 'highlight', label: "Highlight (search result highlighting)", tokens: HIGHLIGHT_TOKENS },
  { id: 'overlay', label: "Overlay", tokens: OVERLAY_TOKENS },
  { id: 'spinner', label: "Spinner", tokens: SPINNER_TOKENS },
  { id: 'progress-bar', label: "Progress bar", description: "Every bar-shaped construct in the app — task progress, value meters — draws its track and fill from these two. A caller wanting a bespoke fill colour (Pascal's per-outcome meters) sets --qt-progress-indicator inline rather than reaching for a raw background utility.", tokens: PROGRESS_BAR_TOKENS },
  { id: 'favorite', label: "Favorite", tokens: FAVORITE_TOKENS },
  { id: 'toggle', label: "Toggle", tokens: TOGGLE_TOKENS },
  { id: 'warning-box', label: "Warning box", tokens: WARNING_BOX_TOKENS },
  { id: 'filter-chip', label: "Filter chip", tokens: FILTER_CHIP_TOKENS },
  { id: 'tab', label: "Tab", tokens: TAB_TOKENS },
  { id: 'workspace', label: "Workspace", description: "The tabbed workspace (_workspace.css). These are read there as hooks with a fallback; the registry declares them so they are listed.", tokens: WORKSPACE_TOKENS },
  { id: 'terminal', label: "Terminal", description: "Terminals carry a \"terminal\" identity regardless of the surrounding theme's light/dark mode (so a parchment theme can still render a dark terminal pane). Themes may override these in their own block.", tokens: TERMINAL_TOKENS },
];
