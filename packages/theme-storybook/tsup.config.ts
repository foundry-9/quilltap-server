import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'preset/index': 'src/preset/index.ts',
    'stories/index': 'src/stories/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  external: ['react', '@storybook/react', 'storybook'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
