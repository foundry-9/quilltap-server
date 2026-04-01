/**
 * Chat Story Component
 *
 * Displays chat-related UI components for theme development.
 * This is crucial for Quilltap's primary use case.
 */

import React from 'react';

export const Chat: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Chat Components</h2>

      {/* Message Bubbles */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Message Bubbles
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '32rem' }}>
          {/* User Message */}
          <div className="qt-chat-message qt-chat-message-user">
            <div className="qt-chat-bubble qt-chat-bubble-user">
              <p>Hello! How are you today?</p>
            </div>
            <span className="qt-chat-timestamp">2:30 PM</span>
          </div>

          {/* AI Message */}
          <div className="qt-chat-message qt-chat-message-assistant">
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">AI</div>
            </div>
            <div>
              <div className="qt-chat-bubble qt-chat-bubble-assistant">
                <p>Hello! I&apos;m doing well, thank you for asking. How can I help you today?</p>
              </div>
              <span className="qt-chat-timestamp">2:30 PM</span>
            </div>
          </div>

          {/* Long AI Message */}
          <div className="qt-chat-message qt-chat-message-assistant">
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">AI</div>
            </div>
            <div>
              <div className="qt-chat-bubble qt-chat-bubble-assistant">
                <p>Here&apos;s some information you might find helpful:</p>
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
                  <li>First point of interest</li>
                  <li>Second important detail</li>
                  <li>Third relevant fact</li>
                </ul>
                <p style={{ marginTop: '0.5rem' }}>Let me know if you&apos;d like more details about any of these!</p>
              </div>
              <span className="qt-chat-timestamp">2:31 PM</span>
            </div>
          </div>

          {/* User Message */}
          <div className="qt-chat-message qt-chat-message-user">
            <div className="qt-chat-bubble qt-chat-bubble-user">
              <p>That&apos;s exactly what I needed, thanks!</p>
            </div>
            <span className="qt-chat-timestamp">2:32 PM</span>
          </div>
        </div>
      </section>

      {/* Character Message Variants */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Character Messages
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Messages from different characters with their avatars.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '32rem' }}>
          <div className="qt-chat-message qt-chat-message-assistant">
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">A</div>
            </div>
            <div>
              <div className="qt-chat-name">Alice</div>
              <div className="qt-chat-bubble qt-chat-bubble-assistant">
                <p>*waves cheerfully* Hi there! I&apos;m so glad to meet you!</p>
              </div>
            </div>
          </div>

          <div className="qt-chat-message qt-chat-message-assistant">
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">B</div>
            </div>
            <div>
              <div className="qt-chat-name">Bob</div>
              <div className="qt-chat-bubble qt-chat-bubble-assistant">
                <p>*nods thoughtfully* Interesting point. Let me think about that...</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Chat Input */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Chat Input
        </h3>
        <div className="qt-chat-input-container" style={{ maxWidth: '32rem' }}>
          <div className="qt-chat-input-wrapper">
            <button className="qt-button-icon" aria-label="Attach file">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <textarea
              className="qt-chat-input"
              placeholder="Type a message..."
              rows={1}
            />
            <button className="qt-button qt-button-primary qt-button-sm">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      {/* Typing Indicator */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Typing Indicator
        </h3>
        <div className="qt-chat-message qt-chat-message-assistant" style={{ maxWidth: '32rem' }}>
          <div className="qt-avatar qt-avatar-sm">
            <div className="qt-avatar-fallback">AI</div>
          </div>
          <div className="qt-chat-bubble qt-chat-bubble-assistant">
            <div className="qt-typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      </section>

      {/* Chat List */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Chat List
        </h3>
        <div className="qt-chat-list" style={{ maxWidth: '24rem' }}>
          {[
            { name: 'Alice Character', preview: "Hi there! I'm so glad to...", time: '2:30 PM', unread: 2 },
            { name: 'Bob Character', preview: 'Let me think about that...', time: '1:15 PM', unread: 0 },
            { name: 'Carol Character', preview: "That's a great question!", time: 'Yesterday', unread: 0 },
          ].map((chat, i) => (
            <div key={i} className={`qt-chat-list-item ${chat.unread > 0 ? 'qt-chat-list-item-unread' : ''}`}>
              <div className="qt-avatar">
                <div className="qt-avatar-fallback">{chat.name[0]}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: chat.unread > 0 ? 600 : 500 }}>{chat.name}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>{chat.time}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.125rem' }}>
                  <span style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chat.preview}
                  </span>
                  {chat.unread > 0 && (
                    <span className="qt-badge qt-badge-primary" style={{ borderRadius: '9999px', minWidth: '1.25rem', textAlign: 'center' }}>
                      {chat.unread}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Full Chat Layout Preview */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Full Chat Layout
        </h3>
        <div className="qt-chat-container" style={{ height: '24rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
          {/* Chat Header */}
          <div className="qt-chat-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div className="qt-avatar">
                <div className="qt-avatar-fallback">AI</div>
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>Assistant</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>Online</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="qt-button-icon" aria-label="Settings">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Chat Messages */}
          <div className="qt-chat-messages">
            <div className="qt-chat-message qt-chat-message-assistant">
              <div className="qt-avatar qt-avatar-sm">
                <div className="qt-avatar-fallback">AI</div>
              </div>
              <div>
                <div className="qt-chat-bubble qt-chat-bubble-assistant">
                  <p>Hello! How can I help you today?</p>
                </div>
              </div>
            </div>
            <div className="qt-chat-message qt-chat-message-user">
              <div className="qt-chat-bubble qt-chat-bubble-user">
                <p>I&apos;d like to know more about theming.</p>
              </div>
            </div>
          </div>

          {/* Chat Input */}
          <div className="qt-chat-footer">
            <div className="qt-chat-input-wrapper">
              <textarea
                className="qt-chat-input"
                placeholder="Type a message..."
                rows={1}
              />
              <button className="qt-button qt-button-primary qt-button-sm">Send</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
