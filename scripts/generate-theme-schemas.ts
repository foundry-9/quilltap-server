#!/usr/bin/env tsx
/**
 * Writes public/schemas/qtap-theme.schema.json and
 * public/schemas/qtap-theme-tokens.schema.json from the theme engine's Zod
 * schemas and the token registry (lib/themes/schemas.ts).
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { GENERATED_THEME_SCHEMAS } from '../lib/themes/schemas';

const ROOT = path.resolve(__dirname, '..');
for (const schema of GENERATED_THEME_SCHEMAS) {
  writeFileSync(path.join(ROOT, schema.path), schema.render(), 'utf8');
  console.log(`Wrote ${schema.path}`);
}
