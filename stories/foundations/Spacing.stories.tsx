import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Spacing and border radius visualization for theme development.
 * Shows the spacing scale and radius tokens.
 */

const Spacing: React.FC = () => {
  const radiusTokens = [
    { name: 'None', variable: '0', value: '0' },
    { name: 'Small', variable: '--radius-sm', value: 'var(--radius-sm)' },
    { name: 'Medium', variable: '--radius-md', value: 'var(--radius-md)' },
    { name: 'Large', variable: '--radius-lg', value: 'var(--radius-lg)' },
    { name: 'Extra Large', variable: '--radius-xl', value: 'var(--radius-xl)' },
    { name: 'Full', variable: '9999px', value: '9999px' },
  ];

  const componentRadii = [
    { name: 'Button', variable: '--qt-button-radius' },
    { name: 'Card', variable: '--qt-card-radius' },
    { name: 'Input', variable: '--qt-input-radius' },
    { name: 'Dialog', variable: '--qt-dialog-radius' },
    { name: 'Badge', variable: '--qt-badge-radius' },
    { name: 'Avatar', variable: '--qt-avatar-radius' },
    { name: 'Chat Message', variable: '--qt-chat-message-radius' },
  ];

  const shadowTokens = [
    { name: 'Card Shadow', variable: '--qt-card-shadow' },
    { name: 'Card Hover Shadow', variable: '--qt-card-shadow-hover' },
    { name: 'Panel Shadow', variable: '--qt-panel-shadow' },
    { name: 'Dialog Shadow', variable: '--qt-dialog-shadow' },
    { name: 'Popover Shadow', variable: '--qt-popover-shadow' },
    { name: 'Button Primary Shadow', variable: '--qt-button-primary-shadow' },
    { name: 'Chat Message Shadow', variable: '--qt-chat-message-shadow' },
  ];

  return (
    <div className="p-6 space-y-12">
      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Border Radius Scale</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
          {radiusTokens.map((token) => (
            <div key={token.name} className="text-center">
              <div
                className="w-20 h-20 mx-auto bg-blue-500 mb-2"
                style={{ borderRadius: token.value }}
              />
              <div className="font-semibold text-sm">{token.name}</div>
              <code className="text-xs text-gray-500">{token.variable}</code>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Component Border Radii</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {componentRadii.map((token) => (
            <div key={token.name} className="text-center">
              <div
                className="w-24 h-16 mx-auto bg-gray-300 dark:bg-gray-600 border border-gray-400 dark:border-gray-500 mb-2"
                style={{ borderRadius: `var(${token.variable})` }}
              />
              <div className="font-semibold text-sm">{token.name}</div>
              <code className="text-xs text-gray-500">{token.variable}</code>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Shadows</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {shadowTokens.map((token) => (
            <div key={token.name} className="p-4">
              <div
                className="w-full h-24 bg-white dark:bg-gray-800 rounded-lg mb-2"
                style={{ boxShadow: `var(${token.variable})` }}
              />
              <div className="font-semibold text-sm">{token.name}</div>
              <code className="text-xs text-gray-500">{token.variable}</code>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Common Spacing Values</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Component-specific padding values that themes can customize.
        </p>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div
              className="bg-blue-100 dark:bg-blue-900 border border-blue-300"
              style={{
                padding: `var(--qt-button-padding-y) var(--qt-button-padding-x)`,
              }}
            >
              Button padding
            </div>
            <code className="text-xs text-gray-500">
              --qt-button-padding-x, --qt-button-padding-y
            </code>
          </div>
          <div className="flex items-center gap-4">
            <div
              className="bg-green-100 dark:bg-green-900 border border-green-300"
              style={{ padding: `var(--qt-card-padding)` }}
            >
              Card padding
            </div>
            <code className="text-xs text-gray-500">--qt-card-padding</code>
          </div>
          <div className="flex items-center gap-4">
            <div
              className="bg-purple-100 dark:bg-purple-900 border border-purple-300"
              style={{
                padding: `var(--qt-input-padding-y) var(--qt-input-padding-x)`,
              }}
            >
              Input padding
            </div>
            <code className="text-xs text-gray-500">
              --qt-input-padding-x, --qt-input-padding-y
            </code>
          </div>
          <div className="flex items-center gap-4">
            <div
              className="bg-orange-100 dark:bg-orange-900 border border-orange-300"
              style={{ padding: `var(--qt-chat-message-padding)` }}
            >
              Chat message padding
            </div>
            <code className="text-xs text-gray-500">--qt-chat-message-padding</code>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Layout Dimensions</h2>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div
              className="bg-gray-200 dark:bg-gray-700 flex items-center justify-center"
              style={{
                height: 'var(--qt-navbar-height)',
                width: '200px',
              }}
            >
              Navbar height
            </div>
            <code className="text-xs text-gray-500">--qt-navbar-height</code>
          </div>
          <div className="flex items-center gap-4">
            <div
              className="bg-gray-200 dark:bg-gray-700 flex items-center justify-center"
              style={{
                width: 'var(--qt-sidebar-width)',
                height: '100px',
              }}
            >
              Sidebar width
            </div>
            <code className="text-xs text-gray-500">--qt-sidebar-width</code>
          </div>
          <div className="flex items-center gap-4">
            <div
              className="bg-gray-200 dark:bg-gray-700 flex items-center justify-center"
              style={{
                width: 'var(--qt-chat-sidebar-width)',
                height: '100px',
              }}
            >
              Chat sidebar width
            </div>
            <code className="text-xs text-gray-500">--qt-chat-sidebar-width</code>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof Spacing> = {
  title: 'Foundations/Spacing',
  component: Spacing,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof Spacing>;

export const SpacingAndRadius: Story = {};
