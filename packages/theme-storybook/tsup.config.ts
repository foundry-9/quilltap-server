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
    // qt-components.css mirrors app rules that point at assets the Quilltap
    // server serves (`/api/themes/assets/...`). Leave those URLs alone rather
    // than trying to bundle them.
    options.external = [...(options.external ?? []), '/api/*'];
  },
});
