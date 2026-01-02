import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Chat message stories showing user, assistant, and system message variants.
 * These use the qt-chat-* classes from the Quilltap component system.
 */

const ChatMessageShowcase: React.FC = () => {
  return (
    <div className="space-y-8 max-w-2xl">
      <section>
        <h3 className="text-lg font-semibold mb-4">Message Types</h3>
        <div className="space-y-4">
          {/* User Message */}
          <div className="qt-chat-message qt-chat-message-user">
            <div className="qt-chat-message-header">
              <span className="qt-chat-message-author">You</span>
              <span className="qt-chat-message-time">2:30 PM</span>
            </div>
            <div className="qt-chat-message-content">
              <p>Hello! Can you help me with something?</p>
            </div>
          </div>

          {/* Assistant Message */}
          <div className="qt-chat-message qt-chat-message-assistant">
            <div className="qt-chat-message-header">
              <span className="qt-chat-message-author">Alice</span>
              <span className="qt-chat-message-time">2:31 PM</span>
            </div>
            <div className="qt-chat-message-content">
              <p>Of course! I&apos;d be happy to help you. What do you need assistance with?</p>
            </div>
          </div>

          {/* System Message */}
          <div className="qt-chat-message qt-chat-message-system">
            <div className="qt-chat-message-content">
              <p>Alice has joined the conversation.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Roleplay Annotations</h3>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Special text formatting for roleplay-style messages.
        </p>
        <div className="space-y-4">
          <div className="qt-chat-message qt-chat-message-assistant">
            <div className="qt-chat-message-header">
              <span className="qt-chat-message-author">Alice</span>
            </div>
            <div className="qt-chat-message-content">
              <p>&quot;Hello there!&quot; <span className="qt-chat-narration">she said with a warm smile, stepping forward to greet you.</span></p>
            </div>
          </div>

          <div className="qt-chat-message qt-chat-message-assistant">
            <div className="qt-chat-message-header">
              <span className="qt-chat-message-author">Alice</span>
            </div>
            <div className="qt-chat-message-content">
              <p><span className="qt-chat-narration">She paused for a moment, considering her words carefully.</span> <span className="qt-chat-inner-monologue">I wonder if they noticed...</span></p>
            </div>
          </div>

          <div className="qt-chat-message qt-chat-message-assistant">
            <div className="qt-chat-message-header">
              <span className="qt-chat-message-author">Alice</span>
            </div>
            <div className="qt-chat-message-content">
              <p><span className="qt-chat-ooc">OOC: Should we continue the scene or take a break?</span></p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Message with Actions</h3>
        <div className="qt-chat-message qt-chat-message-assistant">
          <div className="qt-chat-message-header">
            <span className="qt-chat-message-author">Alice</span>
            <span className="qt-chat-message-time">2:32 PM</span>
          </div>
          <div className="qt-chat-message-content">
            <p>Here&apos;s a longer message that demonstrates the message actions that appear on hover. The actions typically include options like edit, delete, regenerate, and copy.</p>
          </div>
          <div className="qt-chat-message-actions">
            <button className="qt-button-icon" title="Edit">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button className="qt-button-icon" title="Copy">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            <button className="qt-button-icon" title="Delete">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Conversation Example</h3>
        <div className="space-y-4">
          <div className="qt-chat-message qt-chat-message-user">
            <div className="qt-chat-message-header">
              <span className="qt-chat-message-author">You</span>
            </div>
            <div className="qt-chat-message-content">
              <p>Tell me a short story about a dragon.</p>
            </div>
          </div>

          <div className="qt-chat-message qt-chat-message-assistant">
            <div className="qt-chat-message-header">
              <span className="qt-chat-message-author">Storyteller</span>
            </div>
            <div className="qt-chat-message-content">
              <p><span className="qt-chat-narration">The ancient dragon stirred in its mountain cave, scales glinting in the dim light.</span></p>
              <p>&quot;Who dares disturb my slumber?&quot; <span className="qt-chat-narration">it rumbled, smoke curling from its nostrils.</span></p>
              <p><span className="qt-chat-narration">But when it saw the small child at the entrance, holding a wilted flower, something in its heart softened.</span></p>
              <p>&quot;I brought you a gift,&quot; <span className="qt-chat-narration">the child said bravely.</span></p>
              <p><span className="qt-chat-inner-monologue">Perhaps not all humans are the same...</span></p>
            </div>
          </div>

          <div className="qt-chat-message qt-chat-message-user">
            <div className="qt-chat-message-header">
              <span className="qt-chat-message-author">You</span>
            </div>
            <div className="qt-chat-message-content">
              <p>What happens next?</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof ChatMessageShowcase> = {
  title: 'Chat/ChatMessage',
  component: ChatMessageShowcase,
};

export default meta;
type Story = StoryObj<typeof ChatMessageShowcase>;

export const AllMessages: Story = {};

export const UserMessage: Story = {
  render: () => (
    <div className="max-w-2xl">
      <div className="qt-chat-message qt-chat-message-user">
        <div className="qt-chat-message-header">
          <span className="qt-chat-message-author">You</span>
          <span className="qt-chat-message-time">Just now</span>
        </div>
        <div className="qt-chat-message-content">
          <p>This is a user message with the default styling.</p>
        </div>
      </div>
    </div>
  ),
};

export const AssistantMessage: Story = {
  render: () => (
    <div className="max-w-2xl">
      <div className="qt-chat-message qt-chat-message-assistant">
        <div className="qt-chat-message-header">
          <span className="qt-chat-message-author">Assistant</span>
          <span className="qt-chat-message-time">Just now</span>
        </div>
        <div className="qt-chat-message-content">
          <p>This is an assistant message with the default styling. It typically uses a serif font for a more literary feel.</p>
        </div>
      </div>
    </div>
  ),
};

export const SystemMessage: Story = {
  render: () => (
    <div className="max-w-2xl">
      <div className="qt-chat-message qt-chat-message-system">
        <div className="qt-chat-message-content">
          <p>This is a system message, used for status updates and notifications.</p>
        </div>
      </div>
    </div>
  ),
};

export const RoleplayMessage: Story = {
  render: () => (
    <div className="max-w-2xl">
      <div className="qt-chat-message qt-chat-message-assistant">
        <div className="qt-chat-message-header">
          <span className="qt-chat-message-author">Character</span>
        </div>
        <div className="qt-chat-message-content">
          <p><span className="qt-chat-narration">The character approached slowly, their footsteps echoing in the empty hall.</span></p>
          <p>&quot;I&apos;ve been waiting for you,&quot; <span className="qt-chat-narration">they said softly.</span></p>
          <p><span className="qt-chat-inner-monologue">I hope this works...</span></p>
        </div>
      </div>
    </div>
  ),
};
