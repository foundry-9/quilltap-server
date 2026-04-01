/**
 * Storybook Preview Configuration for Quilltap Themes
 *
 * This file provides the theme decorator and global types for
 * theme switching in Storybook.
 *
 * @module @quilltap/theme-storybook/preview
 */

import type { Preview, Decorator } from '@storybook/react';
import React from 'react';

// Import the CSS files
import './css/quilltap-defaults.css';
import './css/qt-components.css';

/**
 * Theme decorator that wraps stories with theme context
 *
 * Applies the selected theme and color mode to the story container.
 * Themes are applied via data-theme attribute, color mode via .dark class.
 */
export const ThemeDecorator: Decorator = (Story, context) => {
  const globals = context.globals as { theme?: string; colorMode?: string };
  const theme = globals.theme || 'default';
  const colorMode = globals.colorMode || 'light';

  return (
    <div
      data-theme={theme === 'default' ? undefined : theme}
      className={colorMode === 'dark' ? 'dark' : ''}
      style={{
        padding: '2rem',
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-foreground)',
        transition: 'background-color 0.3s, color 0.3s',
      }}
    >
      <Story />
    </div>
  );
};

/**
 * Default preview configuration
 *
 * Provides theme and color mode switching in the Storybook toolbar.
 * Theme plugins should add their theme to the toolbar items when
 * configuring their own .storybook/preview.tsx.
 */
export const defaultPreview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme for components',
      defaultValue: 'default',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'default', title: 'Quilltap Default' },
          // Theme plugins should add their theme here
        ],
        dynamicTitle: true,
      },
    },
    colorMode: {
      description: 'Color mode',
      defaultValue: 'light',
      toolbar: {
        title: 'Color Mode',
        icon: 'sun',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [ThemeDecorator],
  parameters: {
    backgrounds: {
      disable: true, // We handle backgrounds via theme
    },
    layout: 'padded',
  },
};

export default defaultPreview;
