import { defineConfig } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'node_modules/**',
      'dist/**',
      '.git/**',
      'coverage/**',
      // Bundled plugin JavaScript files (source is in TypeScript)
      'plugins/dist/**/*.js',
    ],
  },
  {
    rules: {
      // Disable no-img-element globally - we often use <img> intentionally
      // for dynamic/external images that Next.js Image can't optimize
      '@next/next/no-img-element': 'off',
    },
  },
])

export default eslintConfig
