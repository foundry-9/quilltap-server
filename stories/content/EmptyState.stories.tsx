import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Empty state component stories.
 * Uses the qt-empty-state-* classes.
 */

const EmptyStateShowcase: React.FC = () => {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-4">Basic Empty State</h3>
        <div className="qt-empty-state">
          <div className="qt-empty-state-icon">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h4 className="qt-empty-state-title">No messages yet</h4>
          <p className="qt-empty-state-description">
            Start a conversation to see messages appear here.
          </p>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Empty State with Action</h3>
        <div className="qt-empty-state">
          <div className="qt-empty-state-icon">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <h4 className="qt-empty-state-title">No characters</h4>
          <p className="qt-empty-state-description">
            You haven&apos;t created any characters yet. Create your first character to get started.
          </p>
          <div className="qt-empty-state-action">
            <button className="qt-button qt-button-primary">
              Create Character
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Search Empty State</h3>
        <div className="qt-empty-state">
          <div className="qt-empty-state-icon">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h4 className="qt-empty-state-title">No results found</h4>
          <p className="qt-empty-state-description">
            Try adjusting your search or filters to find what you&apos;re looking for.
          </p>
          <div className="qt-empty-state-action">
            <button className="qt-button qt-button-secondary">
              Clear Filters
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Error Empty State</h3>
        <div className="qt-empty-state">
          <div className="qt-empty-state-icon text-red-500">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h4 className="qt-empty-state-title">Something went wrong</h4>
          <p className="qt-empty-state-description">
            We couldn&apos;t load the content. Please try again.
          </p>
          <div className="qt-empty-state-action">
            <button className="qt-button qt-button-primary">
              Try Again
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof EmptyStateShowcase> = {
  title: 'Content/EmptyState',
  component: EmptyStateShowcase,
};

export default meta;
type Story = StoryObj<typeof EmptyStateShowcase>;

export const AllEmptyStates: Story = {};

export const Basic: Story = {
  render: () => (
    <div className="qt-empty-state">
      <div className="qt-empty-state-icon">
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <h4 className="qt-empty-state-title">No items</h4>
      <p className="qt-empty-state-description">Nothing to show here yet.</p>
    </div>
  ),
};

export const WithAction: Story = {
  render: () => (
    <div className="qt-empty-state">
      <div className="qt-empty-state-icon">
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
        </svg>
      </div>
      <h4 className="qt-empty-state-title">Create something new</h4>
      <p className="qt-empty-state-description">Get started by creating your first item.</p>
      <div className="qt-empty-state-action">
        <button className="qt-button qt-button-primary">Create</button>
      </div>
    </div>
  ),
};
