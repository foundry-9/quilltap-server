import type { Preview } from '@storybook/react';
import React from 'react';

// Import the global styles - globals.css includes Tailwind
// qt-components is imported via the app layout normally
import '../app/globals.css';

// Theme decorator that wraps stories with theme context
const ThemeDecorator = (Story: React.ComponentType, context: { globals: { theme: string; colorMode: string } }) => {
  const theme = context.globals.theme || 'default';
  const colorMode = context.globals.colorMode || 'light';

  return (
    <div
      data-theme={theme}
      className={colorMode === 'dark' ? 'dark' : ''}
      style={{
        padding: '1rem',
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-foreground)',
      }}
    >
      <Story />
    </div>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme for components',
      defaultValue: 'default',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'default', title: 'Default' },
          { value: 'ocean', title: 'Ocean' },
          { value: 'earl-grey', title: 'Earl Grey' },
          { value: 'rains', title: 'Rains' },
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

export default preview;
