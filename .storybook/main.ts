import type { StorybookConfig } from '@storybook/nextjs';
import type { Configuration } from 'webpack';

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
  addons: [],
  framework: {
    name: '@storybook/nextjs',
    options: {},
  },
  staticDirs: ['../public'],
  typescript: {
    reactDocgen: 'react-docgen-typescript',
  },
  webpackFinal: async (config: Configuration) => {
    // Ensure PostCSS is configured correctly for Tailwind v4
    const cssRule = config.module?.rules?.find(
      (rule) => rule && typeof rule === 'object' && rule.test?.toString().includes('css')
    );

    if (cssRule && typeof cssRule === 'object' && Array.isArray(cssRule.use)) {
      const postcssLoader = cssRule.use.find(
        (loader) => typeof loader === 'object' && loader?.loader?.includes('postcss-loader')
      );

      if (postcssLoader && typeof postcssLoader === 'object') {
        postcssLoader.options = {
          ...postcssLoader.options,
          postcssOptions: {
            plugins: [
              ['@tailwindcss/postcss', {}],
              ['autoprefixer', {}],
            ],
          },
        };
      }
    }

    return config;
  },
};

export default config;
