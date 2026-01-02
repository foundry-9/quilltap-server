import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Chat composer stories showing the message input area.
 * Uses the qt-chat-composer-* classes.
 */

const ComposerShowcase: React.FC = () => {
  return (
    <div className="space-y-8 max-w-2xl">
      <section>
        <h3 className="text-lg font-semibold mb-4">Basic Composer</h3>
        <div className="qt-chat-composer">
          <textarea
            className="qt-chat-composer-input"
            placeholder="Type a message..."
            rows={1}
          />
          <div className="qt-chat-composer-actions">
            <button className="qt-button qt-button-primary qt-chat-composer-send">
              Send
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Composer with Toolbar</h3>
        <div className="qt-chat-composer">
          <div className="qt-chat-toolbar mb-2">
            <button className="qt-chat-toolbar-button" title="Attach file">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <button className="qt-chat-toolbar-button" title="Generate image">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            <div className="flex-1" />
            <button className="qt-chat-toolbar-button" title="Settings">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
          <textarea
            className="qt-chat-composer-input"
            placeholder="Type a message..."
            rows={2}
          />
          <div className="qt-chat-composer-actions">
            <button className="qt-button qt-button-primary qt-chat-composer-send">
              Send
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Roleplay Annotation Buttons</h3>
        <div className="qt-rp-annotation-toolbar">
          <button className="qt-rp-annotation-button-narration" title="Narration">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            Narration
          </button>
          <button className="qt-rp-annotation-button-internal" title="Inner Monologue">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Thoughts
          </button>
          <button className="qt-rp-annotation-button-ooc" title="Out of Character">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            OOC
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Attachments</h3>
        <div className="qt-chat-composer">
          <div className="qt-chat-attachment-list mb-2">
            <div className="qt-chat-attachment-chip">
              <span>document.pdf</span>
              <button className="ml-2 text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="qt-chat-attachment-chip">
              <span>image.png</span>
              <button className="ml-2 text-gray-400 hover:text-gray-600">×</button>
            </div>
          </div>
          <textarea
            className="qt-chat-composer-input"
            placeholder="Add a message about your files..."
            rows={1}
          />
          <div className="qt-chat-composer-actions">
            <button className="qt-chat-attachment-button" title="Add attachment">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button className="qt-button qt-button-primary qt-chat-composer-send">
              Send
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Chat Control Buttons</h3>
        <div className="flex gap-4">
          <button className="qt-chat-continue-button">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Continue
          </button>
          <button className="qt-chat-stop-button">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
            Stop
          </button>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof ComposerShowcase> = {
  title: 'Chat/Composer',
  component: ComposerShowcase,
};

export default meta;
type Story = StoryObj<typeof ComposerShowcase>;

export const AllComposers: Story = {};

export const BasicComposer: Story = {
  render: () => (
    <div className="max-w-2xl">
      <div className="qt-chat-composer">
        <textarea
          className="qt-chat-composer-input"
          placeholder="Type a message..."
          rows={1}
        />
        <div className="qt-chat-composer-actions">
          <button className="qt-button qt-button-primary qt-chat-composer-send">
            Send
          </button>
        </div>
      </div>
    </div>
  ),
};

export const ComposerWithToolbar: Story = {
  render: () => (
    <div className="max-w-2xl">
      <div className="qt-chat-composer">
        <div className="qt-chat-toolbar mb-2">
          <button className="qt-chat-toolbar-button">Attach</button>
          <button className="qt-chat-toolbar-button">Image</button>
        </div>
        <textarea
          className="qt-chat-composer-input"
          placeholder="Type a message..."
          rows={2}
        />
        <div className="qt-chat-composer-actions">
          <button className="qt-button qt-button-primary qt-chat-composer-send">
            Send
          </button>
        </div>
      </div>
    </div>
  ),
};
