// Side-effect stylesheet imports (src/preview.tsx). TypeScript 6 checks that
// side-effect imports resolve (noUncheckedSideEffectImports), and plain .css
// files have no declarations of their own.
declare module '*.css';
