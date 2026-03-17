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

      {/* Active Participant */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Active Participant
        </h3>
        <div style={{ maxWidth: '20rem' }}>
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
