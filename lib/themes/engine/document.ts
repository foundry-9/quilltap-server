/**
 * Theme engine — the version 2 theme document (Calliope Live, Spec A Stage 3).
 *
 * A version 2 bundle is `theme.json` (`formatVersion: 2`), a `tokens.json`
 * (primitives, registry token overrides, choices), optional custom CSS, and
 * assets. These Zod schemas are the source of truth for the shape; the rules
 * that need the registry or the bundle's file list are in ./validate.ts.
 *
 * @module themes/engine/document
 */

import { z } from 'zod';
import { isSafeBundlePath } from './css-text';

const SAFE_PATH_MESSAGE = 'Must be a path inside the bundle using only letters, digits, ".", "_", "-" and "/"';

/** A file inside a version 2 bundle (stricter than version 1's bundle paths). */
export const V2BundlePathSchema = z.string().min(1).refine(isSafeBundlePath, { message: SAFE_PATH_MESSAGE });

const ThemeIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'Lowercase letters, digits and hyphens, starting with a letter');

const AuthorSchema = z.union([
  z.string().min(1),
  z.strictObject({
    name: z.string().min(1),
    email: z.email().optional(),
    url: z.url().optional(),
  }),
]);

/** An SPDX licence identifier (or expression), or "proprietary". */
const LicenseSchema = z
  .string()
  .regex(/^(proprietary|[A-Za-z0-9.+\-]+( (AND|OR|WITH) [A-Za-z0-9.+\-]+)*)$/, 'An SPDX identifier (e.g. "OFL-1.1") or "proprietary"');

export const V2FontSchema = z.strictObject({
  family: z.string().min(1).max(100),
  src: V2BundlePathSchema.refine((p) => /\.(woff2?|ttf|otf)$/i.test(p), { message: 'A font file: .woff2, .woff, .ttf or .otf' }),
  weight: z
    .string()
    .regex(/^(normal|bold|[1-9]00|[1-9]00 [1-9]00)$/, 'A weight such as "400", "700", "400 700", "normal" or "bold"')
    .optional(),
  style: z.enum(['normal', 'italic', 'oblique']).optional(),
  display: z.enum(['auto', 'block', 'swap', 'fallback', 'optional']).optional(),
  license: LicenseSchema,
  licenseFile: V2BundlePathSchema.optional(),
});
export type V2Font = z.infer<typeof V2FontSchema>;

const SubsystemImageSchema = z.union([z.literal('none'), V2BundlePathSchema]);

export const V2SubsystemSchema = z.strictObject({
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  thumbnail: SubsystemImageSchema.optional(),
  backgroundImage: SubsystemImageSchema.optional(),
});

/** theme.json, formatVersion 2. `extendsTheme` is not part of version 2. */
export const ThemeManifestV2Schema = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal('qtap-theme'),
  formatVersion: z.literal(2),
  id: ThemeIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  version: z.string().regex(/^[0-9A-Za-z.+-]{1,64}$/, 'A version such as "1.0.0"'),
  author: AuthorSchema,
  license: LicenseSchema.optional(),
  compatibility: z.strictObject({ quilltapVersion: z.string().optional() }).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  supportsDarkMode: z.boolean().default(true),
  previewImage: V2BundlePathSchema.optional(),
  tokensPath: V2BundlePathSchema.default('tokens.json'),
  stylesPath: V2BundlePathSchema.optional(),
  fonts: z.array(V2FontSchema).max(40).optional(),
  icons: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), V2BundlePathSchema).optional(),
  subsystems: z.record(z.string(), V2SubsystemSchema).optional(),
});
export type ThemeManifestV2 = z.infer<typeof ThemeManifestV2Schema>;

export const PRIMITIVE_TYPES = ['color', 'length', 'radius', 'shadow', 'font-family', 'font-weight', 'duration', 'easing', 'opacity', 'image', 'number', 'raw'] as const;

export const PrimitiveSchema = z.strictObject({
  type: z.enum(PRIMITIVE_TYPES),
  value: z.string().min(1),
  dark: z.string().min(1).optional(),
});
export type ThemePrimitive = z.infer<typeof PrimitiveSchema>;

export const TokenValueSchema = z.union([
  z.string().min(1),
  z.strictObject({ value: z.string().min(1), dark: z.string().min(1).optional() }),
]);
export type ThemeTokenValue = z.infer<typeof TokenValueSchema>;

/** tokens.json for a version 2 theme. A theme stores only what it overrides. */
export const ThemeTokensDocumentSchema = z.strictObject({
  $schema: z.string().optional(),
  primitives: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, 'Primitive names are kebab-case'), PrimitiveSchema).default({}),
  tokens: z.record(z.string().regex(/^--[a-z0-9-]+$/, 'Token keys are registry names such as "--theme-primary"'), TokenValueSchema).default({}),
  choices: z.record(z.string(), z.string()).default({}),
});
export type ThemeTokensDocument = z.infer<typeof ThemeTokensDocumentSchema>;

/** A parsed version 2 theme: manifest, tokens and (raw) custom CSS. */
export interface ThemeDocument {
  manifest: ThemeManifestV2;
  tokens: ThemeTokensDocument;
  /** The custom CSS as written, before scoping. */
  css?: string;
}

/** `{ value, dark }` for a token entry (dark undefined when both modes share it). */
export function tokenModes(value: ThemeTokenValue): { value: string; dark?: string } {
  return typeof value === 'string' ? { value } : value;
}

/** The CSS custom property a primitive is emitted as. */
export const primitiveVar = (name: string) => `--p-${name}`;
