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
    // qt-components.css is generated from the app's rules, which point at
    // root-relative assets the Quilltap server serves (`/api/themes/assets/...`,
    // `/images/...`, `/quill.svg`). Leave every root-relative URL alone rather
    // than trying to bundle it; the package's own imports are all relative.
    options.external = [...(options.external ?? []), '/*'];
  },
});
