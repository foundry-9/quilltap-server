/**
 * Color Palette Story Component
 *
 * Displays all color tokens for theme development.
 */

import React from 'react';

interface ColorSwatchProps {
  name: string;
  variable: string;
  description?: string;
}

export const ColorSwatch: React.FC<ColorSwatchProps> = ({ name, variable, description }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem' }}>
    <div
      style={{
        width: '4rem',
        height: '4rem',
        borderRadius: '0.5rem',
        border: '1px solid var(--color-border)',
        boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
        backgroundColor: `var(${variable})`,
      }}
    />
    <div>
      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{name}</div>
      <code style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>{variable}</code>
      {description && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)', marginTop: '0.25rem' }}>
          {description}
        </div>
      )}
    </div>
  </div>
);

interface ColorGroupProps {
  title: string;
  colors: ColorSwatchProps[];
}

export const ColorGroup: React.FC<ColorGroupProps> = ({ title, colors }) => (
  <div style={{ marginBottom: '2rem' }}>
    <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
      {title}
    </h3>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
      {colors.map((color) => (
        <ColorSwatch key={color.variable} {...color} />
      ))}
    </div>
  </div>
);

export const ColorPalette: React.FC = () => {
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
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Color Palette</h2>
      <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '2rem' }}>
        These colors are defined by the current theme. Switch themes using the toolbar to see how they change.
      </p>

      <ColorGroup title="Base Colors" colors={baseColors} />
      <ColorGroup title="Semantic Colors" colors={semanticColors} />
      <ColorGroup title="Status Colors" colors={statusColors} />
      <ColorGroup title="Chat Colors" colors={chatColors} />
      <ColorGroup title="Component Tokens" colors={componentTokens} />
    </div>
  );
};
