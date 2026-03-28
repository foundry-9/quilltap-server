import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'tools/index': 'src/tools/index.ts',
    'logging/index': 'src/logging/index.ts',
    'providers/index': 'src/providers/index.ts',
    'roleplay-templates/index': 'src/roleplay-templates/index.ts',
    'system-prompts/index': 'src/system-prompts/index.ts',
    'host-rewrite': 'src/host-rewrite.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['@quilltap/plugin-types', 'openai'],
});
