import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Color palette visualization for theme development.
 * Shows all semantic color tokens and their current values.
 */

interface ColorSwatchProps {
  name: string;
  variable: string;
  description?: string;
}

const ColorSwatch: React.FC<ColorSwatchProps> = ({ name, variable, description }) => (
  <div className="flex items-center gap-4 p-2">
    <div
      className="w-16 h-16 rounded-lg border border-gray-300 dark:border-gray-600 shadow-sm"
      style={{ backgroundColor: `var(${variable})` }}
    />
    <div>
      <div className="font-semibold text-sm">{name}</div>
      <code className="text-xs text-gray-500 dark:text-gray-400">{variable}</code>
      {description && <div className="text-xs text-gray-400 mt-1">{description}</div>}
    </div>
  </div>
);

interface ColorGroupProps {
  title: string;
  colors: ColorSwatchProps[];
}

const ColorGroup: React.FC<ColorGroupProps> = ({ title, colors }) => (
  <div className="mb-8">
    <h3 className="text-lg font-bold mb-4 border-b pb-2">{title}</h3>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {colors.map((color) => (
        <ColorSwatch key={color.variable} {...color} />
      ))}
    </div>
  </div>
);

const ColorPalette: React.FC = () => {
  const baseColors: ColorSwatchProps[] = [
    { name: 'Background', variable: '--color-background', description: 'Page background' },
    { name: 'Foreground', variable: '--color-foreground', description: 'Primary text' },
    { name: 'Card', variable: '--color-card', description: 'Card backgrounds' },
    { name: 'Card Foreground', variable: '--color-card-foreground', description: 'Text on cards' },
    { name: 'Muted', variable: '--color-muted', description: 'Subtle backgrounds' },
    { name: 'Muted Foreground', variable: '--color-muted-foreground', description: 'Secondary text' },
    { name: 'Border', variable: '--color-border', description: 'Default borders' },
    { name: 'Input', variable: '--color-input', description: 'Input borders' },
    { name: 'Ring', variable: '--color-ring', description: 'Focus rings' },
  ];

  const semanticColors: ColorSwatchProps[] = [
    { name: 'Primary', variable: '--color-primary', description: 'Primary actions' },
    { name: 'Primary Foreground', variable: '--color-primary-foreground', description: 'Text on primary' },
    { name: 'Secondary', variable: '--color-secondary', description: 'Secondary actions' },
    { name: 'Secondary Foreground', variable: '--color-secondary-foreground', description: 'Text on secondary' },
    { name: 'Destructive', variable: '--color-destructive', description: 'Dangerous actions' },
    { name: 'Destructive Foreground', variable: '--color-destructive-foreground', description: 'Text on destructive' },
  ];

  const statusColors: ColorSwatchProps[] = [
    { name: 'Success', variable: '--color-success', description: 'Success states' },
    { name: 'Warning', variable: '--color-warning', description: 'Warning states' },
    { name: 'Info', variable: '--color-info', description: 'Informational' },
  ];

  const chatColors: ColorSwatchProps[] = [
    { name: 'Chat User', variable: '--color-chat-user', description: 'User message background' },
    { name: 'Chat User Foreground', variable: '--color-chat-user-foreground', description: 'User message text' },
  ];

  const componentTokens: ColorSwatchProps[] = [
    { name: 'Button Primary BG', variable: '--qt-button-primary-bg', description: 'Primary button background' },
    { name: 'Button Primary Hover', variable: '--qt-button-primary-hover-bg', description: 'Primary button hover' },
    { name: 'Card BG', variable: '--qt-card-bg', description: 'Card background' },
    { name: 'Card Border', variable: '--qt-card-border', description: 'Card border' },
    { name: 'Input BG', variable: '--qt-input-bg', description: 'Input background' },
    { name: 'Input Border', variable: '--qt-input-border', description: 'Input border' },
  ];

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Color Palette</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        These colors are defined by the current theme. Switch themes using the toolbar above to see how they change.
      </p>

      <ColorGroup title="Base Colors" colors={baseColors} />
      <ColorGroup title="Semantic Colors" colors={semanticColors} />
      <ColorGroup title="Status Colors" colors={statusColors} />
      <ColorGroup title="Chat Colors" colors={chatColors} />
      <ColorGroup title="Component Tokens" colors={componentTokens} />
    </div>
  );
};

const meta: Meta<typeof ColorPalette> = {
  title: 'Foundations/Colors',
  component: ColorPalette,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof ColorPalette>;

export const Palette: Story = {};
