/**
 * The published JSON Schemas for a version 2 theme bundle.
 *
 * `public/schemas/qtap-theme.schema.json` (theme.json) and
 * `public/schemas/qtap-theme-tokens.schema.json` (tokens.json) are generated
 * from the engine's Zod schemas (`lib/themes/engine/document.ts`), with the
 * token registry's names and each choice's options enumerated in the tokens
 * schema so an editor can complete them. Edit the Zod schemas or the
 * registry, then run `npm run generate:theme-schemas`; `npm run lint` fails
 * while the committed files disagree.
 *
 * The schemas describe shape only. The rules that need the bundle's files,
 * the icon names or the subsystem ids are the engine's (`validateThemeDocument`),
 * run by the app and by `quilltap themes validate`.
 *
 * @module themes/schemas
 */

import { toJSONSchema } from 'zod';
import { ThemeManifestSchema, ThemeTokensDocumentSchema } from './engine/document';
import { THEME_CHOICES, THEME_TOKENS } from './registry';

export const THEME_SCHEMAS_REGENERATE_COMMAND = 'npm run generate:theme-schemas';

const SCHEMA_BASE_URL = 'https://quilltap.ai/schemas';

/** What a bundle's theme.json and tokens.json name in `$schema`. */
export const THEME_MANIFEST_SCHEMA_URL = `${SCHEMA_BASE_URL}/qtap-theme.schema.json`;
export const THEME_TOKENS_SCHEMA_URL = `${SCHEMA_BASE_URL}/qtap-theme-tokens.schema.json`;

export interface GeneratedThemeSchema {
  /** Repo-relative path of the committed file. */
  path: string;
  render(): string;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' ? (value as JsonObject) : {};
}

function withHeader(id: string, title: string, description: string, body: JsonObject): JsonObject {
  const { $schema, ...rest } = body;
  return {
    $schema: $schema ?? 'https://json-schema.org/draft/2020-12/schema',
    $id: id,
    title,
    description,
    ...rest,
  };
}

function render(schema: JsonObject): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

export function renderThemeManifestSchema(): string {
  const body = asObject(toJSONSchema(ThemeManifestSchema, { reused: 'inline', io: 'input' }));
  return render(
    withHeader(
      THEME_MANIFEST_SCHEMA_URL,
      'Quilltap theme manifest (formatVersion 2)',
      'theme.json in a .qtap-theme bundle. Generated from lib/themes/engine/document.ts; the rules that need the bundle itself are checked by `quilltap themes validate`.',
      body
    )
  );
}

export function renderThemeTokensSchema(): string {
  const body = asObject(toJSONSchema(ThemeTokensDocumentSchema, { reused: 'inline', io: 'input' }));
  const properties = asObject(body.properties);
  const tokens = asObject(properties.tokens);
  const valueSchema = asObject(tokens.additionalProperties);

  const tokenProperties: JsonObject = {};
  for (const token of [...THEME_TOKENS].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = [token.label, `${token.type}, group ${token.group}`, `default: ${token.default}`];
    if (token.defaultDark !== undefined) parts.push(`dark default: ${token.defaultDark}`);
    tokenProperties[token.name] = { ...valueSchema, description: parts.join(' — ') };
  }
  const { propertyNames: _names, additionalProperties: _extra, ...tokenRest } = tokens;
  properties.tokens = {
    ...tokenRest,
    description: 'Registry token overrides: a value for both modes, or { value, dark }. A theme stores only what it changes.',
    properties: tokenProperties,
    additionalProperties: false,
  };

  const choiceProperties: JsonObject = {};
  for (const choice of THEME_CHOICES) {
    choiceProperties[choice.name] = {
      type: 'string',
      enum: [...choice.options],
      default: choice.default,
      description: `${choice.label} — ${choice.description}`,
    };
  }
  const { propertyNames: _cNames, additionalProperties: _cExtra, ...choicesRest } = asObject(properties.choices);
  properties.choices = { ...choicesRest, properties: choiceProperties, additionalProperties: false };

  return render(
    withHeader(
      THEME_TOKENS_SCHEMA_URL,
      'Quilltap theme tokens (formatVersion 2)',
      'tokens.json in a .qtap-theme bundle: primitives, registry token overrides and choices. Generated from lib/themes/engine/document.ts and the token registry.',
      { ...body, properties }
    )
  );
}

export const GENERATED_THEME_SCHEMAS: readonly GeneratedThemeSchema[] = [
  { path: 'public/schemas/qtap-theme.schema.json', render: renderThemeManifestSchema },
  { path: 'public/schemas/qtap-theme-tokens.schema.json', render: renderThemeTokensSchema },
];
