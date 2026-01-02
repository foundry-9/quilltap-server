import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Participant card stories showing the chat participant UI.
 * Uses the qt-participant-* classes.
 */

const ParticipantShowcase: React.FC = () => {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-4">Participant Cards</h3>
        <div className="space-y-2 max-w-sm">
          <div className="qt-participant-card">
            <div className="qt-participant-card-header">
              <div className="qt-participant-card-avatar">
                <div className="qt-avatar">
                  <div className="qt-avatar-fallback">AC</div>
                </div>
              </div>
              <div className="qt-participant-card-info">
                <div className="qt-participant-card-name">Alice Character</div>
                <div className="qt-participant-card-status">AI Assistant</div>
              </div>
            </div>
          </div>

          <div className="qt-participant-card qt-participant-card-active">
            <div className="qt-participant-card-header">
              <div className="qt-participant-card-avatar">
                <div className="qt-avatar">
                  <div className="qt-avatar-fallback">BC</div>
                </div>
              </div>
              <div className="qt-participant-card-info">
                <div className="qt-participant-card-name">Bob Character</div>
                <div className="qt-participant-card-status">Currently Speaking</div>
              </div>
            </div>
          </div>

          <div className="qt-participant-card">
            <div className="qt-participant-card-header">
              <div className="qt-participant-card-avatar">
                <div className="qt-avatar">
                  <div className="qt-avatar-fallback">YO</div>
                </div>
              </div>
              <div className="qt-participant-card-info">
                <div className="qt-participant-card-name">You</div>
                <div className="qt-participant-card-status">Human</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Mobile Participant Bar</h3>
        <div className="qt-mobile-participant-bar">
          <div className="qt-mobile-participant-avatar">
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">AC</div>
            </div>
          </div>
          <div className="qt-mobile-participant-avatar">
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">BC</div>
            </div>
          </div>
          <div className="qt-mobile-participant-avatar">
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">YO</div>
            </div>
          </div>
          <button className="qt-mobile-participant-dropdown">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Chat Sidebar Layout</h3>
        <div className="flex gap-4">
          <div className="flex-1 qt-card p-4">
            <p className="text-gray-500">Chat messages area</p>
          </div>
          <div className="qt-chat-sidebar w-64">
            <div className="p-4 border-b" style={{ borderColor: 'var(--qt-chat-sidebar-header-border)' }}>
              <h4 className="font-semibold" style={{ color: 'var(--qt-chat-sidebar-heading)' }}>
                Participants
              </h4>
            </div>
            <div className="p-2 space-y-2">
              <div className="qt-participant-card qt-participant-card-active">
                <div className="qt-participant-card-header">
                  <div className="qt-participant-card-avatar">
                    <div className="qt-avatar qt-avatar-sm">
                      <div className="qt-avatar-fallback">AC</div>
                    </div>
                  </div>
                  <div className="qt-participant-card-info">
                    <div className="qt-participant-card-name text-sm">Alice</div>
                  </div>
                </div>
              </div>
              <div className="qt-participant-card">
                <div className="qt-participant-card-header">
                  <div className="qt-participant-card-avatar">
                    <div className="qt-avatar qt-avatar-sm">
                      <div className="qt-avatar-fallback">YO</div>
                    </div>
                  </div>
                  <div className="qt-participant-card-info">
                    <div className="qt-participant-card-name text-sm">You</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof ParticipantShowcase> = {
  title: 'Chat/Participant',
  component: ParticipantShowcase,
};

export default meta;
type Story = StoryObj<typeof ParticipantShowcase>;

export const AllParticipants: Story = {};

export const ParticipantCard: Story = {
  render: () => (
    <div className="max-w-sm">
      <div className="qt-participant-card">
        <div className="qt-participant-card-header">
          <div className="qt-participant-card-avatar">
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">AC</div>
            </div>
          </div>
          <div className="qt-participant-card-info">
            <div className="qt-participant-card-name">Alice Character</div>
            <div className="qt-participant-card-status">AI Assistant</div>
          </div>
        </div>
      </div>
    </div>
  ),
};

export const ActiveParticipant: Story = {
  render: () => (
    <div className="max-w-sm">
      <div className="qt-participant-card qt-participant-card-active">
        <div className="qt-participant-card-header">
          <div className="qt-participant-card-avatar">
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">AC</div>
            </div>
          </div>
          <div className="qt-participant-card-info">
            <div className="qt-participant-card-name">Alice Character</div>
            <div className="qt-participant-card-status">Currently Speaking</div>
          </div>
        </div>
      </div>
    </div>
  ),
};
