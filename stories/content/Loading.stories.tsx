import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Loading state component stories.
 * Uses the qt-spinner-* and qt-skeleton-* classes.
 */

const LoadingShowcase: React.FC = () => {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-4">Spinners</h3>
        <div className="flex items-center gap-8">
          <div>
            <div className="qt-spinner qt-spinner-sm" />
            <p className="text-xs text-center mt-2">Small</p>
          </div>
          <div>
            <div className="qt-spinner" />
            <p className="text-xs text-center mt-2">Default</p>
          </div>
          <div>
            <div className="qt-spinner qt-spinner-lg" />
            <p className="text-xs text-center mt-2">Large</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Skeleton Text</h3>
        <div className="space-y-2 max-w-md">
          <div className="qt-skeleton qt-skeleton-text" style={{ width: '100%' }} />
          <div className="qt-skeleton qt-skeleton-text" style={{ width: '80%' }} />
          <div className="qt-skeleton qt-skeleton-text" style={{ width: '60%' }} />
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Skeleton Card</h3>
        <div className="qt-card max-w-sm p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="qt-skeleton qt-skeleton-circle" style={{ width: '40px', height: '40px' }} />
            <div className="flex-1 space-y-2">
              <div className="qt-skeleton qt-skeleton-text" style={{ width: '60%' }} />
              <div className="qt-skeleton qt-skeleton-text" style={{ width: '40%' }} />
            </div>
          </div>
          <div className="space-y-2">
            <div className="qt-skeleton qt-skeleton-text" />
            <div className="qt-skeleton qt-skeleton-text" />
            <div className="qt-skeleton qt-skeleton-text" style={{ width: '75%' }} />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Skeleton Message</h3>
        <div className="max-w-2xl space-y-4">
          <div className="flex gap-3">
            <div className="qt-skeleton qt-skeleton-circle" style={{ width: '32px', height: '32px' }} />
            <div className="flex-1 space-y-2">
              <div className="qt-skeleton qt-skeleton-text" style={{ width: '120px' }} />
              <div className="qt-card p-4">
                <div className="space-y-2">
                  <div className="qt-skeleton qt-skeleton-text" />
                  <div className="qt-skeleton qt-skeleton-text" />
                  <div className="qt-skeleton qt-skeleton-text" style={{ width: '60%' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Skeleton List</h3>
        <div className="space-y-2 max-w-sm">
          {[1, 2, 3].map((i) => (
            <div key={i} className="qt-card p-3 flex items-center gap-3">
              <div className="qt-skeleton qt-skeleton-circle" style={{ width: '32px', height: '32px' }} />
              <div className="flex-1">
                <div className="qt-skeleton qt-skeleton-text" style={{ width: '70%' }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Loading Button</h3>
        <div className="flex gap-4">
          <button className="qt-button qt-button-primary" disabled>
            <div className="qt-spinner qt-spinner-sm mr-2" />
            Loading...
          </button>
          <button className="qt-button qt-button-secondary" disabled>
            <div className="qt-spinner qt-spinner-sm mr-2" />
            Saving...
          </button>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof LoadingShowcase> = {
  title: 'Content/Loading',
  component: LoadingShowcase,
};

export default meta;
type Story = StoryObj<typeof LoadingShowcase>;

export const AllLoading: Story = {};

export const Spinner: Story = {
  render: () => <div className="qt-spinner" />,
};

export const SpinnerSmall: Story = {
  render: () => <div className="qt-spinner qt-spinner-sm" />,
};

export const SpinnerLarge: Story = {
  render: () => <div className="qt-spinner qt-spinner-lg" />,
};

export const SkeletonText: Story = {
  render: () => (
    <div className="space-y-2 max-w-md">
      <div className="qt-skeleton qt-skeleton-text" style={{ width: '100%' }} />
      <div className="qt-skeleton qt-skeleton-text" style={{ width: '80%' }} />
      <div className="qt-skeleton qt-skeleton-text" style={{ width: '60%' }} />
    </div>
  ),
};

export const SkeletonCard: Story = {
  render: () => (
    <div className="qt-card max-w-sm p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="qt-skeleton qt-skeleton-circle" style={{ width: '40px', height: '40px' }} />
        <div className="flex-1 space-y-2">
          <div className="qt-skeleton qt-skeleton-text" style={{ width: '60%' }} />
          <div className="qt-skeleton qt-skeleton-text" style={{ width: '40%' }} />
        </div>
      </div>
    </div>
  ),
};
