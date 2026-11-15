/**
 * Theme token registry — the contrast pairs.
 *
 * Each pair names a foreground token, the background token it is drawn on
 * and a kind: `text` must reach 4.5:1, `non-text` (focus rings and other
 * parts that are not words) 3:1 — WCAG 2.2 AA, in light and in dark. The
 * engine's `checkContrast` (`lib/themes/engine/contrast.ts`) measures them;
 * the editor, `quilltap themes validate` and `scripts/check-theme-contrast.ts`
 * report them. Data, not code: add a pair here and every reader picks it up.
 * A test fails if a pair names a token the registry does not have.
 *
 * Framework-free: importable by the server, the client and scripts.
 *
 * @module themes/registry/contrast
 */

export type ContrastKind = 'text' | 'non-text';

export interface ContrastPair {
  /** Stable id (`<foreground>/<background>` with the `--` dropped), used by the exception list. */
  id: string;
  foreground: `--${string}`;
  background: `--${string}`;
  kind: ContrastKind;
}

/** The ratio each kind must reach. */
export const CONTRAST_THRESHOLDS: Readonly<Record<ContrastKind, number>> = { text: 4.5, 'non-text': 3 };

const pair = (foreground: `--${string}`, background: `--${string}`, kind: ContrastKind = 'text'): ContrastPair => ({
  id: `${foreground.slice(2)}/${background.slice(2)}`,
  foreground,
  background,
  kind,
});

const onOwnSurface = (base: string): ContrastPair => pair(`--theme-${base}-foreground`, `--theme-${base}`);

const BADGES = [
  'primary', 'secondary', 'character', 'user-character', 'chat', 'tag', 'memory', 'message', 'project', 'related',
  'source-npm', 'source-git', 'wardrobe-top', 'wardrobe-bottom', 'wardrobe-footwear', 'wardrobe-accessories',
  'wardrobe-hair', 'wardrobe-shared', 'capability',
] as const;

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // ---- colors: page text and each surface's own foreground
  pair('--theme-foreground', '--theme-background'),
  ...(['card', 'popover', 'primary', 'secondary', 'accent', 'destructive', 'success', 'warning', 'info', 'chat-user'] as const).map(onOwnSurface),
  // muted text on the surfaces it is used on
  pair('--theme-muted-foreground', '--theme-background'),
  pair('--theme-muted-foreground', '--theme-card'),
  pair('--theme-muted-foreground', '--theme-muted'),
  // the focus ring
  pair('--theme-ring', '--theme-background', 'non-text'),
  pair('--theme-ring', '--theme-card', 'non-text'),
  // ---- sidebar
  pair('--theme-sidebar-foreground', '--theme-sidebar-background'),
  pair('--theme-sidebar-muted', '--theme-sidebar-background'),
  pair('--theme-sidebar-accent-foreground', '--theme-sidebar-accent'),
  // ---- status: alert text on the alert's tinted surface
  ...(['success', 'warning', 'error', 'info'] as const).map((s) => pair(`--qt-alert-${s}-fg`, `--qt-alert-${s}-bg`)),
  // ---- category: badge text on the badge's tinted surface
  ...BADGES.map((b) => pair(`--qt-badge-${b}-fg`, `--qt-badge-${b}-bg`)),
  // ---- chat surfaces
  pair('--qt-chat-user-fg', '--qt-chat-user-bg'),
  pair('--qt-chat-assistant-fg', '--qt-chat-assistant-bg'),
  pair('--qt-chat-whisper-fg', '--qt-chat-whisper-bg'),
  pair('--qt-chat-whisper-label-fg', '--qt-chat-whisper-bg'),
  pair('--qt-chat-silent-fg', '--qt-chat-silent-bg'),
  pair('--qt-chat-silent-label-fg', '--qt-chat-silent-bg'),
  pair('--qt-chat-wardrobe-fg', '--qt-chat-wardrobe-bg'),
  pair('--qt-chat-wardrobe-label-fg', '--qt-chat-wardrobe-bg'),
  pair('--qt-chat-system-bar-fg', '--qt-chat-system-bar-bg'),
  // ---- roleplay chips
  ...([1, 2, 3, 4] as const).map((n) => pair(`--theme-roleplay-chip-${n}-foreground`, `--theme-roleplay-chip-${n}`)),
  // ---- links
  pair('--qt-link-color', '--theme-background'),
  pair('--qt-link-color', '--theme-card'),
];
