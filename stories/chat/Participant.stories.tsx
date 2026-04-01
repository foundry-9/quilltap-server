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

export const WithConnectionProfileDropdown: Story = {
  render: () => (
    <div className="max-w-sm space-y-4">
      <h4 className="text-sm font-medium">Card with Connection Profile Dropdown</h4>
      <div className="qt-participant-card">
        <div className="qt-participant-card-header">
          <div className="qt-participant-card-avatar">
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">AC</div>
            </div>
          </div>
          <div className="qt-participant-card-info">
            <div className="qt-participant-card-name">Alice Character</div>
            <div className="qt-participant-card-status italic">AI Assistant</div>
            <div className="mt-1">
              <select className="qt-select qt-select-sm w-full" defaultValue="gpt-4">
                <option value="">Select a provider...</option>
                <option value="__user__">User (you type)</option>
                <option value="gpt-4">gpt-4-turbo</option>
                <option value="claude">claude-3-opus</option>
                <option value="gemini">gemini-pro</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <h4 className="text-sm font-medium">Card set to User Control</h4>
      <div className="qt-participant-card">
        <div className="qt-participant-card-header">
          <div className="qt-participant-card-avatar">
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">BC</div>
            </div>
          </div>
          <div className="qt-participant-card-info">
            <div className="flex items-center gap-2">
              <div className="qt-participant-card-name">Bob Character</div>
              <span className="qt-badge-secondary text-xs">You</span>
            </div>
            <div className="mt-1">
              <select className="qt-select qt-select-sm w-full" defaultValue="__user__">
                <option value="">Select a provider...</option>
                <option value="__user__">User (you type)</option>
                <option value="gpt-4">gpt-4-turbo</option>
                <option value="claude">claude-3-opus</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};

export const WithExpandableSettings: Story = {
  render: () => (
    <div className="max-w-sm space-y-4">
      <h4 className="text-sm font-medium">Card with Expanded Settings</h4>
      <div className="qt-participant-card">
        <div className="qt-participant-card-header">
          <div className="qt-participant-card-avatar">
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">AC</div>
            </div>
          </div>
          <div className="qt-participant-card-info">
            <div className="qt-participant-card-name">Alice Character</div>
            <div className="mt-1">
              <select className="qt-select qt-select-sm w-full" defaultValue="gpt-4">
                <option value="gpt-4">gpt-4-turbo</option>
                <option value="claude">claude-3-opus</option>
              </select>
            </div>
          </div>
        </div>
        <div className="qt-participant-card-actions">
          <button className="flex-1 qt-button qt-button-secondary qt-button-sm">Nudge</button>
          <button className="qt-button qt-button-sm py-1.5 px-2 qt-button-primary">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
        {/* Expanded settings */}
        <div className="mt-2 pt-2 border-t border-border space-y-2">
          <div>
            <label className="qt-text-xs block mb-1">System Prompt Override</label>
            <textarea
              className="qt-textarea qt-text-xs w-full"
              rows={2}
              placeholder="Custom scenario or context..."
              defaultValue="You are in a mysterious forest clearing at midnight."
            />
          </div>
          <label className="flex items-center gap-2 qt-text-xs cursor-pointer">
            <input type="checkbox" defaultChecked className="rounded border-input" />
            Active in chat
          </label>
        </div>
      </div>
    </div>
  ),
};
