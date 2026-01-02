import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Badge component stories showing all variants.
 * Uses the qt-badge-* classes from the Quilltap component system.
 */

const BadgeShowcase: React.FC = () => {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-4">Basic Variants</h3>
        <div className="flex flex-wrap gap-2">
          <span className="qt-badge qt-badge-primary">Primary</span>
          <span className="qt-badge qt-badge-secondary">Secondary</span>
          <span className="qt-badge qt-badge-outline">Outline</span>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Status Badges</h3>
        <div className="flex flex-wrap gap-2">
          <span className="qt-badge qt-badge-success">Success</span>
          <span className="qt-badge qt-badge-warning">Warning</span>
          <span className="qt-badge qt-badge-destructive">Error</span>
          <span className="qt-badge qt-badge-info">Info</span>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Entity Type Badges</h3>
        <div className="flex flex-wrap gap-2">
          <span className="qt-badge qt-badge-character">Character</span>
          <span className="qt-badge qt-badge-persona">Persona</span>
          <span className="qt-badge qt-badge-chat">Chat</span>
          <span className="qt-badge qt-badge-tag">Tag</span>
          <span className="qt-badge qt-badge-memory">Memory</span>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">State Badges</h3>
        <div className="flex flex-wrap gap-2">
          <span className="qt-badge qt-badge-enabled">Enabled</span>
          <span className="qt-badge qt-badge-disabled">Disabled</span>
          <span className="qt-badge qt-badge-related">Related</span>
          <span className="qt-badge qt-badge-manual">Manual</span>
          <span className="qt-badge qt-badge-auto">Auto</span>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Plugin Source Badges</h3>
        <div className="flex flex-wrap gap-2">
          <span className="qt-badge qt-badge-source-included">Included</span>
          <span className="qt-badge qt-badge-source-npm">NPM</span>
          <span className="qt-badge qt-badge-source-git">Git</span>
          <span className="qt-badge qt-badge-source-manual">Manual</span>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Tag Badges</h3>
        <div className="flex flex-wrap gap-2">
          <span className="qt-tag-badge">
            Fantasy
          </span>
          <span className="qt-tag-badge">
            Sci-Fi
          </span>
          <span className="qt-tag-badge">
            Romance
          </span>
          <span className="qt-tag-badge qt-tag-badge-emoji">
            Adventure
          </span>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Removable Tags</h3>
        <div className="flex flex-wrap gap-2">
          <span className="qt-tag-badge">
            Fantasy
            <button className="qt-tag-badge-remove ml-1">×</button>
          </span>
          <span className="qt-tag-badge">
            Sci-Fi
            <button className="qt-tag-badge-remove ml-1">×</button>
          </span>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Badges in Context</h3>
        <div className="qt-card max-w-md">
          <div className="qt-card-header flex items-center justify-between">
            <div>
              <h4 className="qt-card-title">Character Name</h4>
              <p className="qt-card-description">A mysterious figure</p>
            </div>
            <span className="qt-badge qt-badge-character">Character</span>
          </div>
          <div className="qt-card-body">
            <div className="flex flex-wrap gap-1">
              <span className="qt-tag-badge qt-tag-badge-sm">Fantasy</span>
              <span className="qt-tag-badge qt-tag-badge-sm">Adventure</span>
              <span className="qt-tag-badge qt-tag-badge-sm">Mystery</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof BadgeShowcase> = {
  title: 'Content/Badge',
  component: BadgeShowcase,
};

export default meta;
type Story = StoryObj<typeof BadgeShowcase>;

export const AllBadges: Story = {};

export const Primary: Story = {
  render: () => <span className="qt-badge qt-badge-primary">Primary Badge</span>,
};

export const Secondary: Story = {
  render: () => <span className="qt-badge qt-badge-secondary">Secondary Badge</span>,
};

export const Outline: Story = {
  render: () => <span className="qt-badge qt-badge-outline">Outline Badge</span>,
};

export const StatusBadges: Story = {
  render: () => (
    <div className="flex gap-2">
      <span className="qt-badge qt-badge-success">Success</span>
      <span className="qt-badge qt-badge-warning">Warning</span>
      <span className="qt-badge qt-badge-destructive">Error</span>
      <span className="qt-badge qt-badge-info">Info</span>
    </div>
  ),
};
