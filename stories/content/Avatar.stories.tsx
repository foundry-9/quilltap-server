import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Avatar component stories showing all sizes and variants.
 * Uses the qt-avatar-* classes from the Quilltap component system.
 */

const AvatarShowcase: React.FC = () => {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-4">Sizes</h3>
        <div className="flex items-end gap-4">
          <div>
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">SM</div>
            </div>
            <p className="text-xs text-center mt-1">Small</p>
          </div>
          <div>
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">MD</div>
            </div>
            <p className="text-xs text-center mt-1">Default</p>
          </div>
          <div>
            <div className="qt-avatar qt-avatar-lg">
              <div className="qt-avatar-fallback">LG</div>
            </div>
            <p className="text-xs text-center mt-1">Large</p>
          </div>
          <div>
            <div className="qt-avatar qt-avatar-xl">
              <div className="qt-avatar-fallback">XL</div>
            </div>
            <p className="text-xs text-center mt-1">Extra Large</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">With Images</h3>
        <div className="flex items-center gap-4">
          <div className="qt-avatar">
            <img
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=Alice"
              alt="Alice"
              className="qt-avatar-image"
            />
          </div>
          <div className="qt-avatar">
            <img
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=Bob"
              alt="Bob"
              className="qt-avatar-image"
            />
          </div>
          <div className="qt-avatar">
            <img
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=Carol"
              alt="Carol"
              className="qt-avatar-image"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Fallback Initials</h3>
        <div className="flex items-center gap-4">
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">AC</div>
          </div>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">JD</div>
          </div>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">?</div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Avatar Group</h3>
        <div className="qt-avatar-group">
          <div className="qt-avatar">
            <img
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=Alice"
              alt="Alice"
              className="qt-avatar-image"
            />
          </div>
          <div className="qt-avatar">
            <img
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=Bob"
              alt="Bob"
              className="qt-avatar-image"
            />
          </div>
          <div className="qt-avatar">
            <img
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=Carol"
              alt="Carol"
              className="qt-avatar-image"
            />
          </div>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">+3</div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">In Context</h3>
        <div className="flex items-center gap-3">
          <div className="qt-avatar qt-avatar-lg">
            <img
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=Profile"
              alt="User"
              className="qt-avatar-image"
            />
          </div>
          <div>
            <h4 className="font-semibold">John Doe</h4>
            <p className="text-sm text-gray-500">Character Creator</p>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof AvatarShowcase> = {
  title: 'Content/Avatar',
  component: AvatarShowcase,
};

export default meta;
type Story = StoryObj<typeof AvatarShowcase>;

export const AllAvatars: Story = {};

export const Small: Story = {
  render: () => (
    <div className="qt-avatar qt-avatar-sm">
      <div className="qt-avatar-fallback">SM</div>
    </div>
  ),
};

export const Default: Story = {
  render: () => (
    <div className="qt-avatar">
      <div className="qt-avatar-fallback">MD</div>
    </div>
  ),
};

export const Large: Story = {
  render: () => (
    <div className="qt-avatar qt-avatar-lg">
      <div className="qt-avatar-fallback">LG</div>
    </div>
  ),
};

export const ExtraLarge: Story = {
  render: () => (
    <div className="qt-avatar qt-avatar-xl">
      <div className="qt-avatar-fallback">XL</div>
    </div>
  ),
};

export const WithImage: Story = {
  render: () => (
    <div className="qt-avatar">
      <img
        src="https://api.dicebear.com/7.x/avataaars/svg?seed=Demo"
        alt="Demo"
        className="qt-avatar-image"
      />
    </div>
  ),
};

export const Group: Story = {
  render: () => (
    <div className="qt-avatar-group">
      <div className="qt-avatar">
        <div className="qt-avatar-fallback">A</div>
      </div>
      <div className="qt-avatar">
        <div className="qt-avatar-fallback">B</div>
      </div>
      <div className="qt-avatar">
        <div className="qt-avatar-fallback">C</div>
      </div>
    </div>
  ),
};
