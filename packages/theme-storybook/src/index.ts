/**
 * @quilltap/theme-storybook
 *
 * Storybook preset and stories for developing Quilltap theme plugins.
 *
 * @example
 * // In your theme plugin's .storybook/main.ts:
 * import type { StorybookConfig } from '@storybook/react-vite';
 *
 * const config: StorybookConfig = {
 *   stories: [
 *     '../stories/*.stories.tsx',
 *     '../node_modules/@quilltap/theme-storybook/src/stories/*.stories.tsx',
 *   ],
 *   addons: [],
 *   framework: '@storybook/react-vite',
 * };
 *
 * @example
 * // In your theme plugin's .storybook/preview.tsx:
 * import { ThemeDecorator } from '@quilltap/theme-storybook';
 * import '@quilltap/theme-storybook/css/defaults';
 * import '@quilltap/theme-storybook/css/components';
 * import '../src/styles.css'; // Your theme CSS
 *
 * export default {
 *   globalTypes: {
 *     theme: {
 *       defaultValue: 'your-theme',
 *       toolbar: {
 *         items: [
 *           { value: 'default', title: 'Quilltap Default' },
 *           { value: 'your-theme', title: 'Your Theme' },
 *         ],
 *       },
 *     },
 *     colorMode: {
 *       defaultValue: 'dark',
 *       toolbar: {
 *         items: [
 *           { value: 'light', title: 'Light' },
 *           { value: 'dark', title: 'Dark' },
 *         ],
 *       },
 *     },
 *   },
 *   decorators: [ThemeDecorator],
 * };
 *
 * @module @quilltap/theme-storybook
 */

export { ThemeDecorator, defaultPreview } from './preview';

// Re-export story components for easy import
export * from './stories';
