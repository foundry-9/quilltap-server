/**
 * Participant Story Component
 *
 * Displays participant card variants for chat interface theming.
 */

import React from 'react';

export const Participant: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Participants</h2>

      {/* Participant Cards */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Participant Cards
        </h3>
        <div style={{ maxWidth: '20rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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

      {/* Participant Status States */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Participant Status States
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Characters can be active, silent (thinking but not speaking), absent (away from the scene), or removed.
        </p>
        <div style={{ maxWidth: '20rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {/* Active — currently speaking */}
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

          {/* Silent — with badge and avatar overlay */}
          <div className="qt-participant-card qt-participant-card-silent">
            <div className="qt-participant-card-header">
              <div className="qt-participant-card-avatar" style={{ position: 'relative' }}>
                <div className="qt-avatar">
                  <div className="qt-avatar-fallback">BC</div>
                </div>
                <div className="qt-participant-status-overlay qt-participant-status-overlay-silent">
                  <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16.5 12A4.5 4.5 0 0 0 12 7.5v4.09l3.13 3.13A4.46 4.46 0 0 0 16.5 12ZM19 12c0 1.68-.59 3.22-1.57 4.43L21 20l-1.41 1.41-18-18L3 2l4.57 4.57A7.97 7.97 0 0 1 12 4c4.42 0 8 3.58 8 8Zm-7-8a6 6 0 0 0-6 6c0 1.33.44 2.56 1.17 3.56L5 11.44A7.94 7.94 0 0 1 4 8" />
                  </svg>
                </div>
              </div>
              <div className="qt-participant-card-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="qt-participant-card-name">Bob Character</div>
                  <span className="qt-badge-silent" style={{ fontSize: '0.625rem' }}>Silent</span>
                </div>
                <div className="qt-participant-card-status">Inner thoughts only</div>
              </div>
            </div>
          </div>

          {/* Absent — with badge and avatar overlay */}
          <div className="qt-participant-card" style={{ opacity: 0.7 }}>
            <div className="qt-participant-card-header">
              <div className="qt-participant-card-avatar" style={{ position: 'relative' }}>
                <div className="qt-avatar">
                  <div className="qt-avatar-fallback">CC</div>
                </div>
                <div className="qt-participant-status-overlay qt-participant-status-overlay-absent">
                  <svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                  </svg>
                </div>
              </div>
              <div className="qt-participant-card-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="qt-participant-card-name">Clara Character</div>
                  <span className="qt-badge-absent" style={{ fontSize: '0.625rem' }}>Absent</span>
                </div>
                <div className="qt-participant-card-status">Away from the scene</div>
              </div>
            </div>
          </div>

          {/* Human participant */}
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

      {/* Chat Sidebar Layout */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Chat Sidebar Layout
        </h3>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div className="qt-card" style={{ flex: 1, padding: '1rem' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>Chat messages area</p>
          </div>
          <div className="qt-chat-sidebar" style={{ width: '16rem' }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--qt-chat-sidebar-header-border)' }}>
              <h4 style={{ fontWeight: 600, color: 'var(--qt-chat-sidebar-heading)' }}>
                Participants
              </h4>
            </div>
            <div style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div className="qt-participant-card qt-participant-card-active">
                <div className="qt-participant-card-header">
                  <div className="qt-participant-card-avatar">
                    <div className="qt-avatar qt-avatar-sm">
                      <div className="qt-avatar-fallback">AC</div>
                    </div>
                  </div>
                  <div className="qt-participant-card-info">
                    <div className="qt-participant-card-name" style={{ fontSize: '0.875rem' }}>Alice</div>
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
                    <div className="qt-participant-card-name" style={{ fontSize: '0.875rem' }}>You</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Connection Dropdown */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Connection Profile Dropdown
        </h3>
        <div style={{ maxWidth: '20rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                <div style={{ marginTop: '0.25rem' }}>
                  <select className="qt-select qt-select-sm" style={{ width: '100%' }} defaultValue="gpt-4">
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

          <div className="qt-participant-card">
            <div className="qt-participant-card-header">
              <div className="qt-participant-card-avatar">
                <div className="qt-avatar">
                  <div className="qt-avatar-fallback">BC</div>
                </div>
              </div>
              <div className="qt-participant-card-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="qt-participant-card-name">Bob Character</div>
                  <span className="qt-badge-secondary" style={{ fontSize: '0.75rem' }}>You</span>
                </div>
                <div style={{ marginTop: '0.25rem' }}>
                  <select className="qt-select qt-select-sm" style={{ width: '100%' }} defaultValue="__user__">
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
      </section>
    </div>
  );
};
