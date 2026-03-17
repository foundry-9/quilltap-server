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
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div className="qt-chat-message qt-chat-message-user">
              <div className="qt-chat-message-header">
                <span className="qt-chat-message-author">You</span>
                <span className="qt-chat-message-time">2:30 PM</span>
              </div>
              <div className="qt-chat-message-content">
                <p>Hello! How are you today?</p>
              </div>
            </div>
          </div>

          {/* AI Message */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">AI</div>
            </div>
            <div className="qt-chat-message qt-chat-message-assistant">
              <div className="qt-chat-message-header">
                <span className="qt-chat-message-author">Assistant</span>
                <span className="qt-chat-message-time">2:30 PM</span>
              </div>
              <div className="qt-chat-message-content">
                <p>Hello! I&apos;m doing well, thank you for asking. How can I help you today?</p>
              </div>
            </div>
          </div>

          {/* Long AI Message */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">AI</div>
            </div>
            <div className="qt-chat-message qt-chat-message-assistant">
              <div className="qt-chat-message-header">
                <span className="qt-chat-message-author">Assistant</span>
                <span className="qt-chat-message-time">2:31 PM</span>
              </div>
              <div className="qt-chat-message-content">
                <p>Here&apos;s some information you might find helpful:</p>
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
                  <li>First point of interest</li>
                  <li>Second important detail</li>
                  <li>Third relevant fact</li>
                </ul>
                <p style={{ marginTop: '0.5rem' }}>Let me know if you&apos;d like more details about any of these!</p>
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
              </div>
            </div>
          </div>

          {/* System Message */}
          <div className="qt-chat-message qt-chat-message-system">
            <div className="qt-chat-message-content">
              <p>Alice has joined the conversation.</p>
            </div>
          </div>

          {/* User Message */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div className="qt-chat-message qt-chat-message-user">
              <div className="qt-chat-message-header">
                <span className="qt-chat-message-author">You</span>
              </div>
              <div className="qt-chat-message-content">
                <p>That&apos;s exactly what I needed, thanks!</p>
              </div>
            </div>
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
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">A</div>
            </div>
            <div>
              <div className="qt-chat-message-author" style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem' }}>Alice</div>
              <div className="qt-chat-message qt-chat-message-assistant">
                <p>*waves cheerfully* Hi there! I&apos;m so glad to meet you!</p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">B</div>
            </div>
            <div>
              <div className="qt-chat-message-author" style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem' }}>Bob</div>
              <div className="qt-chat-message qt-chat-message-assistant">
                <p>*nods thoughtfully* Interesting point. Let me think about that...</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Roleplay Annotations */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Roleplay Annotations
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Special text formatting for roleplay-style messages with narration, inner thoughts, and out-of-character text.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '32rem' }}>
          {/* Narration */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">A</div>
            </div>
            <div className="qt-chat-message qt-chat-message-assistant">
              <div className="qt-chat-message-header">
                <span className="qt-chat-message-author">Alice</span>
              </div>
              <div className="qt-chat-message-content">
                <p>&quot;Hello there!&quot; <span className="qt-chat-narration">she said with a warm smile, stepping forward to greet you.</span></p>
              </div>
            </div>
          </div>

          {/* Inner Monologue */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">A</div>
            </div>
            <div className="qt-chat-message qt-chat-message-assistant">
              <div className="qt-chat-message-header">
                <span className="qt-chat-message-author">Alice</span>
              </div>
              <div className="qt-chat-message-content">
                <p><span className="qt-chat-narration">She paused for a moment, considering her words carefully.</span> <span className="qt-chat-inner-monologue">I wonder if they noticed...</span></p>
              </div>
            </div>
          </div>

          {/* Out of Character */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">A</div>
            </div>
            <div className="qt-chat-message qt-chat-message-assistant">
              <div className="qt-chat-message-header">
                <span className="qt-chat-message-author">Alice</span>
              </div>
              <div className="qt-chat-message-content">
                <p><span className="qt-chat-ooc">((OOC: Should we continue the scene or take a break?))</span></p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Whisper Messages */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Whisper Messages
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Private messages visible only to sender and recipient. Overheard whispers have a faded style.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '32rem' }}>
          {/* Regular whisper */}
          <div className="qt-chat-message-row qt-chat-message-row-assistant" style={{ marginBottom: '0.5rem' }}>
            <div className="qt-chat-message-body qt-chat-message-assistant qt-chat-message-whisper">
              <div className="qt-chat-whisper-label">whispered to Elena</div>
              <p>I don&apos;t trust the merchant. Meet me at the tavern tonight—alone.</p>
            </div>
          </div>

          {/* Overheard whisper */}
          <div className="qt-chat-message-row qt-chat-message-row-assistant" style={{ marginBottom: '0.5rem' }}>
            <div className="qt-chat-message-body qt-chat-message-assistant qt-chat-message-whisper qt-chat-message-whisper-overheard">
              <div className="qt-chat-whisper-label">whispered to Marcus</div>
              <p>Keep an eye on the door. We may need a quick exit.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Chat Toolbar */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Chat Toolbar
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Formatting and action buttons for chat composition.
        </p>
        <div className="qt-chat-toolbar" style={{ maxWidth: '32rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="qt-chat-toolbar-button" title="Bold">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 4h8a4 4 0 014 4v2M6 4v16M6 4h8a2 2 0 012 2v2M6 12h12" />
            </svg>
          </button>
          <button className="qt-chat-toolbar-button" title="Italic">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 5h4m-4 14h4M9 5h6M9 19H3" />
            </svg>
          </button>
          <button className="qt-chat-toolbar-button" title="Underline">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 5v10a4 4 0 008 0V5m0 14H7" />
            </svg>
          </button>
          <div style={{ flex: 1 }} />
          <button className="qt-chat-toolbar-button" title="Settings">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </section>

      {/* RP Annotation Buttons */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          RP Annotation Buttons
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Quick-insert buttons for roleplay annotation types.
        </p>
        <div className="qt-rp-annotation-toolbar" style={{ maxWidth: '32rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
            Internal
          </button>
          <button className="qt-rp-annotation-button-ooc" title="Out of Character">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            OOC
          </button>
        </div>
      </section>

      {/* Attachments */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Attachments
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          File attachment chips and attachment button.
        </p>
        <div className="qt-chat-composer" style={{ maxWidth: '32rem' }}>
          <div className="qt-chat-attachment-list" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <div className="qt-chat-attachment-chip">
              <span>document.pdf</span>
              <button className="ml-2 text-gray-400 hover:text-gray-600" style={{ marginLeft: '0.5rem' }}>×</button>
            </div>
            <div className="qt-chat-attachment-chip">
              <span>image.png</span>
              <button className="ml-2 text-gray-400 hover:text-gray-600" style={{ marginLeft: '0.5rem' }}>×</button>
            </div>
          </div>
          <textarea
            className="qt-chat-composer-input"
            placeholder="Add a message about your files..."
            rows={1}
            style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
          />
          <div className="qt-chat-composer-actions" style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="qt-chat-attachment-button">
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button className="qt-button qt-button-primary">Send</button>
          </div>
        </div>
      </section>

      {/* Chat Input */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Chat Input
        </h3>
        <div className="qt-chat-composer" style={{ maxWidth: '32rem' }}>
          <div className="qt-chat-composer-inner" style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', flex: 1 }}>
            <button className="qt-button-icon" aria-label="Attach file">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <textarea
              className="qt-chat-composer-input qt-input"
              placeholder="Type a message..."
              rows={1}
            />
            <button className="qt-button qt-button-primary qt-chat-composer-send" style={{ height: 'auto', padding: '0.5rem 1rem' }}>
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
        <div style={{ display: 'flex', gap: '0.5rem', maxWidth: '32rem' }}>
          <div className="qt-avatar qt-avatar-sm">
            <div className="qt-avatar-fallback">AI</div>
          </div>
          <div className="qt-chat-message qt-chat-message-assistant">
            <div className="qt-typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      </section>

      {/* Chat Control Buttons */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Chat Control Buttons
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Continue and stop buttons for controlling AI response generation.
        </p>
        <div style={{ display: 'flex', gap: '1rem', maxWidth: '32rem' }}>
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

      {/* Full Chat Layout Preview */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Full Chat Layout
        </h3>
        <div className="qt-chat-layout" style={{ height: '24rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column' }}>
          {/* Chat Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)' }}>
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
          <div style={{ flex: 1, overflow: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div className="qt-avatar qt-avatar-sm">
                <div className="qt-avatar-fallback">AI</div>
              </div>
              <div className="qt-chat-message qt-chat-message-assistant">
                <p>Hello! How can I help you today?</p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div className="qt-chat-message qt-chat-message-user">
                <p>I&apos;d like to know more about theming.</p>
              </div>
            </div>
          </div>

          {/* Chat Input */}
          <div className="qt-chat-composer" style={{ margin: '0.5rem', borderRadius: 'var(--radius-lg)' }}>
            <textarea
              className="qt-chat-composer-input qt-input"
              placeholder="Type a message..."
              rows={1}
            />
            <button className="qt-button qt-button-primary qt-button-sm">Send</button>
          </div>
        </div>
      </section>
    </div>
  );
};
