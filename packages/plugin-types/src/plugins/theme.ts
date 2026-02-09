/**
 * Theme Plugin Interface types for Quilltap plugin development
 *
 * @module @quilltap/plugin-types/plugins/theme
 */

// ============================================================================
// COLOR TOKENS
// ============================================================================

/**
 * Color palette for a single color mode (light or dark)
 *
 * Colors can be specified as:
 * - HSL values: "222.2 84% 4.9%" (without hsl() wrapper)
 * - Full HSL: "hsl(222.2 84% 4.9%)"
 * - Hex: "#1a1a2e"
 * - Other valid CSS color values: rgb(), oklch(), etc.
 */
export interface ColorPalette {
  // Semantic colors - primary surfaces
  /** Main background color */
  background: string;
  /** Main text color */
  foreground: string;

  // Primary action colors
  /** Primary brand/action color */
  primary: string;
  /** Text on primary color */
  primaryForeground: string;

  // Secondary/muted colors
  /** Secondary background color */
  secondary: string;
  /** Text on secondary color */
  secondaryForeground: string;

  // Muted text and backgrounds
  /** Muted background for less prominent elements */
  muted: string;
  /** Muted text color */
  mutedForeground: string;

  // Accent colors
  /** Accent color for highlights */
  accent: string;
  /** Text on accent color */
  accentForeground: string;

  // Destructive/error colors
  /** Error/destructive action color */
  destructive: string;
  /** Text on destructive color */
  destructiveForeground: string;

  // Card and popover surfaces
  /** Card background color */
  card: string;
  /** Card text color */
  cardForeground: string;
  /** Popover/dropdown background */
  popover: string;
  /** Popover text color */
  popoverForeground: string;

  // Borders and inputs
  /** Default border color */
  border: string;
  /** Input field border color */
  input: string;
  /** Focus ring color */
  ring: string;

  // Optional: Extended palette for advanced themes
  /** Success state color */
  success?: string;
  /** Text on success color */
  successForeground?: string;
  /** Warning state color */
  warning?: string;
  /** Text on warning color */
  warningForeground?: string;
  /** Info state color */
  info?: string;
  /** Text on info color */
  infoForeground?: string;

  // Chat-specific colors
  /** User message bubble background */
  chatUser?: string;
  /** User message bubble text */
  chatUserForeground?: string;
}

// ============================================================================
// TYPOGRAPHY TOKENS
// ============================================================================

/**
 * Typography token configuration
 */
export interface Typography {
  // Font families
  /** Sans-serif font stack (default: "Inter, system-ui, sans-serif") */
  fontSans?: string;
  /** Serif font stack (default: "Georgia, serif") */
  fontSerif?: string;
  /** Monospace font stack (default: "ui-monospace, SFMono-Regular, monospace") */
  fontMono?: string;

  // Font size scale (rem values)
  /** Extra small text - 12px (default: "0.75rem") */
  fontSizeXs?: string;
  /** Small text - 14px (default: "0.875rem") */
  fontSizeSm?: string;
  /** Base text size - 16px (default: "1rem") */
  fontSizeBase?: string;
  /** Large text - 18px (default: "1.125rem") */
  fontSizeLg?: string;
  /** Extra large text - 20px (default: "1.25rem") */
  fontSizeXl?: string;
  /** 2XL text - 24px (default: "1.5rem") */
  fontSize2xl?: string;
  /** 3XL text - 30px (default: "1.875rem") */
  fontSize3xl?: string;
  /** 4XL text - 36px (default: "2.25rem") */
  fontSize4xl?: string;

  // Line heights
  /** Tight line height (default: "1.25") */
  lineHeightTight?: string;
  /** Normal line height (default: "1.5") */
  lineHeightNormal?: string;
  /** Relaxed line height (default: "1.75") */
  lineHeightRelaxed?: string;

  // Font weights
  /** Normal font weight (default: "400") */
  fontWeightNormal?: string;
  /** Medium font weight (default: "500") */
  fontWeightMedium?: string;
  /** Semibold font weight (default: "600") */
  fontWeightSemibold?: string;
  /** Bold font weight (default: "700") */
  fontWeightBold?: string;

  // Letter spacing
  /** Tight letter spacing (default: "-0.025em") */
  letterSpacingTight?: string;
  /** Normal letter spacing (default: "0") */
  letterSpacingNormal?: string;
  /** Wide letter spacing (default: "0.025em") */
  letterSpacingWide?: string;
}

// ============================================================================
// SPACING & LAYOUT TOKENS
// ============================================================================

/**
 * Spacing and layout token configuration
 */
export interface Spacing {
  // Border radius
  /** Small border radius (default: "calc(0.5rem - 4px)") */
  radiusSm?: string;
  /** Medium border radius (default: "calc(0.5rem - 2px)") */
  radiusMd?: string;
  /** Large border radius (default: "0.5rem") */
  radiusLg?: string;
  /** Extra large border radius (default: "0.75rem") */
  radiusXl?: string;
  /** Full/pill border radius (default: "9999px") */
  radiusFull?: string;

  // Spacing scale (for padding, margin, gap)
  /** 4px spacing (default: "0.25rem") */
  spacing1?: string;
  /** 8px spacing (default: "0.5rem") */
  spacing2?: string;
  /** 12px spacing (default: "0.75rem") */
  spacing3?: string;
  /** 16px spacing (default: "1rem") */
  spacing4?: string;
  /** 20px spacing (default: "1.25rem") */
  spacing5?: string;
  /** 24px spacing (default: "1.5rem") */
  spacing6?: string;
  /** 32px spacing (default: "2rem") */
  spacing8?: string;
  /** 40px spacing (default: "2.5rem") */
  spacing10?: string;
  /** 48px spacing (default: "3rem") */
  spacing12?: string;
  /** 64px spacing (default: "4rem") */
  spacing16?: string;
}

// ============================================================================
// EFFECTS TOKENS
// ============================================================================

/**
 * Visual effects token configuration
 */
export interface Effects {
  // Shadows
  /** Small shadow (default: "0 1px 2px 0 rgb(0 0 0 / 0.05)") */
  shadowSm?: string;
  /** Medium shadow (default: "0 4px 6px -1px rgb(0 0 0 / 0.1)") */
  shadowMd?: string;
  /** Large shadow (default: "0 10px 15px -3px rgb(0 0 0 / 0.1)") */
  shadowLg?: string;
  /** Extra large shadow (default: "0 20px 25px -5px rgb(0 0 0 / 0.1)") */
  shadowXl?: string;

  // Transitions
  /** Fast transition duration (default: "150ms") */
  transitionFast?: string;
  /** Normal transition duration (default: "200ms") */
  transitionNormal?: string;
  /** Slow transition duration (default: "300ms") */
  transitionSlow?: string;
  /** Default easing function (default: "cubic-bezier(0.4, 0, 0.2, 1)") */
  transitionEasing?: string;

  // Focus ring
  /** Focus ring width (default: "2px") */
  focusRingWidth?: string;
  /** Focus ring offset (default: "2px") */
  focusRingOffset?: string;
}

// ============================================================================
// COMPLETE THEME TOKENS
// ============================================================================

/**
 * Complete theme tokens structure
 *
 * Contains all customizable values for a theme:
 * - colors: Required light and dark mode color palettes
 * - typography: Optional font customization
 * - spacing: Optional spacing/radius customization
 * - effects: Optional shadows/transitions customization
 */
export interface ThemeTokens {
  /** Light and dark mode color palettes (required) */
  colors: {
    /** Light mode color palette */
    light: ColorPalette;
    /** Dark mode color palette */
    dark: ColorPalette;
  };
  /** Typography customization (optional) */
  typography?: Typography;
  /** Spacing and radius customization (optional) */
  spacing?: Spacing;
  /** Shadow and transition customization (optional) */
  effects?: Effects;
}

// ============================================================================
// FONT DEFINITION
// ============================================================================

/**
 * Custom font definition for themes that include custom fonts
 */
export interface FontDefinition {
  /** Font family name */
  family: string;
  /** Font source URL or relative path */
  src: string;
  /** Font weight (e.g., "400", "700", "400 700") */
  weight?: string;
  /** Font style (e.g., "normal", "italic") */
  style?: string;
  /** Font display strategy */
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}

/**
 * Loaded font with binary data (for self-contained themes)
 */
export interface EmbeddedFont {
  /** Font family name */
  family: string;
  /** Font weight */
  weight: string;
  /** Font style */
  style?: string;
  /** Base64-encoded font data or data URL */
  data: string;
  /** MIME type of the font */
  mimeType?: string;
}

// ============================================================================
// THEME PLUGIN METADATA
// ============================================================================

/**
 * Theme plugin metadata for UI display and identification
 */
export interface ThemeMetadata {
  /** Unique theme identifier (lowercase, hyphens allowed) */
  themeId: string;
  /** Human-readable display name */
  displayName: string;
  /** Theme description */
  description?: string;
  /** Theme author */
  author?: string | {
    name: string;
    email?: string;
    url?: string;
  };
  /** Whether this theme provides dark mode support */
  supportsDarkMode: boolean;
  /** Theme tags for categorization */
  tags?: string[];
  /** Base64-encoded preview image or path */
  previewImage?: string;
}

// ============================================================================
// SUBSYSTEM OVERRIDES
// ============================================================================

/**
 * Optional overrides for Foundry subsystem display in the UI.
 *
 * Theme plugins can provide alternative names, descriptions, and images
 * for any of the 9 Foundry subsystems. For example, a "plain English" theme
 * could rename "The Lantern" to "Image Generation".
 *
 * Image values can be:
 * - Absolute URLs: "https://example.com/image.png"
 * - Data URIs: "data:image/png;base64,..."
 * - Relative paths (resolved to the theme's asset route at runtime): "images/my-lantern.jpg"
 */
export interface SubsystemOverrides {
  /** Override the display name (e.g., "Image Generation" instead of "The Lantern") */
  name?: string;
  /** Override the short description */
  description?: string;
  /** Override the thumbnail image shown on the Foundry hub card */
  thumbnail?: string;
  /** Override the full-page background image on the subsystem page */
  backgroundImage?: string;
}

// ============================================================================
// THEME PLUGIN INTERFACE
// ============================================================================

/**
 * Main Theme Plugin Interface
 *
 * Plugins implementing this interface can be dynamically loaded
 * by Quilltap to provide custom theming.
 *
 * Self-contained themes export all data directly in the plugin object,
 * with no file system dependencies after module load.
 *
 * @example
 * ```typescript
 * import type { ThemePlugin } from '@quilltap/plugin-types';
 *
 * export const plugin: ThemePlugin = {
 *   metadata: {
 *     themeId: 'my-theme',
 *     displayName: 'My Custom Theme',
 *     description: 'A beautiful custom theme',
 *     supportsDarkMode: true,
 *     tags: ['dark', 'minimal'],
 *   },
 *   tokens: {
 *     colors: {
 *       light: {
 *         background: 'hsl(0 0% 100%)',
 *         foreground: 'hsl(222.2 84% 4.9%)',
 *         // ... all required colors
 *       },
 *       dark: {
 *         background: 'hsl(222.2 84% 4.9%)',
 *         foreground: 'hsl(210 40% 98%)',
 *         // ... all required colors
 *       },
 *     },
 *     typography: {
 *       fontSans: '"Custom Font", system-ui, sans-serif',
 *     },
 *   },
 *   cssOverrides: `
 *     .qt-button-primary {
 *       border-radius: 9999px;
 *     }
 *   `,
 *   fonts: [
 *     { family: 'Custom Font', weight: '400', data: 'base64...' },
 *   ],
 * };
 * ```
 */
export interface ThemePlugin {
  /** Theme metadata for UI display and identification */
  metadata: ThemeMetadata;

  /** Theme design tokens (colors, typography, spacing, effects) */
  tokens: ThemeTokens;

  /**
   * Optional CSS overrides for component-level customization (Tier 3)
   * This CSS is injected when the theme is active
   */
  cssOverrides?: string;

  /**
   * Optional embedded fonts
   * Base64-encoded font data for fully self-contained themes
   */
  fonts?: EmbeddedFont[];

  /**
   * Optional subsystem display overrides
   *
   * Allows a theme to rename, re-describe, or re-image any of the
   * Foundry subsystem pages. Keys are subsystem IDs:
   * 'foundry' | 'aurora' | 'forge' | 'salon' | 'commonplace-book' |
   * 'prospero' | 'dangermouse' | 'calliope' | 'lantern'
   */
  subsystems?: Partial<Record<string, SubsystemOverrides>>;

  /**
   * Optional method for dynamic token generation
   * Called when color mode changes, allows computed theme values
   * @param mode Current color mode ('light' | 'dark')
   */
  getTokensForMode?: (mode: 'light' | 'dark') => ThemeTokens;

  /**
   * Optional initialization function
   * Called when the theme is loaded
   */
  initialize?: () => void | Promise<void>;
}

/**
 * Standard export type for theme plugins
 */
export interface ThemePluginExport {
  /** The theme plugin instance */
  plugin: ThemePlugin;
}
