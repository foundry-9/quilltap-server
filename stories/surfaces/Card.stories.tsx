import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Card component stories showing all variants from the qt-card-* classes.
 */

const CardShowcase: React.FC = () => {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-4">Basic Card</h3>
        <div className="qt-card max-w-md">
          <div className="qt-card-header">
            <h4 className="qt-card-title">Card Title</h4>
            <p className="qt-card-description">Card description goes here.</p>
          </div>
          <div className="qt-card-body">
            <p>This is the card body content. It can contain any content you want.</p>
          </div>
          <div className="qt-card-footer">
            <button className="qt-button qt-button-ghost">Cancel</button>
            <button className="qt-button qt-button-primary">Save</button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Interactive Card</h3>
        <div className="qt-card qt-card-interactive max-w-md cursor-pointer">
          <div className="qt-card-header">
            <h4 className="qt-card-title">Clickable Card</h4>
            <p className="qt-card-description">Hover over me to see the effect.</p>
          </div>
          <div className="qt-card-body">
            <p>This card has hover states and can be clicked.</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Entity Cards</h3>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Used for characters, personas, chats, and other list items.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="qt-entity-card">
            <div className="flex items-center gap-3 p-4">
              <div className="qt-avatar">
                <div className="qt-avatar-fallback">AC</div>
              </div>
              <div>
                <h4 className="font-semibold">Alice Character</h4>
                <p className="text-sm text-gray-500">A friendly AI assistant</p>
              </div>
            </div>
          </div>
          <div className="qt-entity-card">
            <div className="flex items-center gap-3 p-4">
              <div className="qt-avatar">
                <div className="qt-avatar-fallback">BC</div>
              </div>
              <div>
                <h4 className="font-semibold">Bob Character</h4>
                <p className="text-sm text-gray-500">A mysterious stranger</p>
              </div>
            </div>
          </div>
          <div className="qt-entity-card">
            <div className="flex items-center gap-3 p-4">
              <div className="qt-avatar">
                <div className="qt-avatar-fallback">CC</div>
              </div>
              <div>
                <h4 className="font-semibold">Carol Character</h4>
                <p className="text-sm text-gray-500">A wise mentor</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Card Grid</h3>
        <div className="qt-card-grid-3">
          <div className="qt-card p-4">
            <h4 className="font-semibold mb-2">Card 1</h4>
            <p className="text-sm text-gray-500">Content</p>
          </div>
          <div className="qt-card p-4">
            <h4 className="font-semibold mb-2">Card 2</h4>
            <p className="text-sm text-gray-500">Content</p>
          </div>
          <div className="qt-card p-4">
            <h4 className="font-semibold mb-2">Card 3</h4>
            <p className="text-sm text-gray-500">Content</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Panel</h3>
        <div className="qt-panel max-w-lg p-6">
          <h4 className="font-semibold mb-2">Panel Content</h4>
          <p className="text-gray-600 dark:text-gray-400">
            Panels are similar to cards but often used for larger content areas
            or sidebar panels.
          </p>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Elevated Panel</h3>
        <div className="qt-panel qt-panel-elevated max-w-lg p-6">
          <h4 className="font-semibold mb-2">Elevated Panel</h4>
          <p className="text-gray-600 dark:text-gray-400">
            This panel has additional shadow for more visual emphasis.
          </p>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof CardShowcase> = {
  title: 'Surfaces/Card',
  component: CardShowcase,
};

export default meta;
type Story = StoryObj<typeof CardShowcase>;

export const AllCards: Story = {};

export const BasicCard: Story = {
  render: () => (
    <div className="qt-card max-w-md">
      <div className="qt-card-header">
        <h4 className="qt-card-title">Card Title</h4>
        <p className="qt-card-description">A simple card with header and body.</p>
      </div>
      <div className="qt-card-body">
        <p>Card body content goes here.</p>
      </div>
    </div>
  ),
};

export const InteractiveCard: Story = {
  render: () => (
    <div className="qt-card qt-card-interactive max-w-md cursor-pointer">
      <div className="p-4">
        <h4 className="font-semibold">Click or hover me</h4>
        <p className="text-sm text-gray-500 mt-1">This card responds to interaction.</p>
      </div>
    </div>
  ),
};

export const EntityCard: Story = {
  render: () => (
    <div className="qt-entity-card max-w-sm">
      <div className="flex items-center gap-3 p-4">
        <div className="qt-avatar qt-avatar-lg">
          <div className="qt-avatar-fallback">JD</div>
        </div>
        <div>
          <h4 className="font-semibold">John Doe</h4>
          <p className="text-sm text-gray-500">Character description here</p>
        </div>
      </div>
    </div>
  ),
};
