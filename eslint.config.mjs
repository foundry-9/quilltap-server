import { defineConfig } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import quilltapPlugin from './eslint-quilltap-plugin.js'

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      '.electron-server-staging/**',
      'next-env.d.ts',
      'node_modules/**',
      'dist/**',
      '.git/**',
      'coverage/**',
      // Bundled plugin JavaScript files (source is in TypeScript)
      'plugins/dist/**/*.js',
      // PDF.js worker file (third-party, copied from node_modules)
      'public/pdf.worker.mjs',
    ],
  },
  {
    rules: {
      // Disable no-img-element globally - we often use <img> intentionally
      // for dynamic/external images that Next.js Image can't optimize
      '@next/next/no-img-element': 'off',
    },
  },
  {
    plugins: {
      quilltap: quilltapPlugin,
    },
    rules: {
      'quilltap/no-quilltap-misspelling': 'error',
    },
  },
])

export default eslintConfig
