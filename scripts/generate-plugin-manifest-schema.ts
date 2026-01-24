#!/usr/bin/env tsx
/**
 * Generates JSON Schema from Zod schema for plugin manifest
 */

import { toJSONSchema } from 'zod';
import { PluginManifestSchema } from '../lib/schemas/plugin-manifest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const jsonSchema = toJSONSchema(PluginManifestSchema, {
  reused: 'inline', // Equivalent to $refStrategy: 'none' - inline all schemas instead of using $ref
});

const outputPath = join(__dirname, '../plugins/dist/qtap-plugin-template/schemas/plugin-manifest.schema.json');

writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2), 'utf-8');

console.log(`✅ Generated JSON Schema at: ${outputPath}`);
