/**
 * Badges Story Component
 *
 * Displays all badge variants and states for theme development.
 */

import React from 'react';

export const Badges: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Badges</h2>

      {/* Badge Variants */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Badge Variants
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <span className="qt-badge qt-badge-default">Default</span>
          <span className="qt-badge qt-badge-primary">Primary</span>
          <span className="qt-badge qt-badge-secondary">Secondary</span>
          <span className="qt-badge qt-badge-success">Success</span>
          <span className="qt-badge qt-badge-warning">Warning</span>
          <span className="qt-badge qt-badge-destructive">Destructive</span>
        </div>
      </section>

      {/* Outline Badges */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Outline Badges
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <span className="qt-badge qt-badge-outline">Outline</span>
          <span className="qt-badge qt-badge-outline-primary">Primary</span>
          <span className="qt-badge qt-badge-outline-success">Success</span>
          <span className="qt-badge qt-badge-outline-warning">Warning</span>
          <span className="qt-badge qt-badge-outline-destructive">Destructive</span>
        </div>
      </section>

      {/* Provider Badges */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Provider Badges
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Used to identify AI provider sources.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <span className="qt-badge qt-badge-provider-openai">OpenAI</span>
          <span className="qt-badge qt-badge-provider-anthropic">Anthropic</span>
          <span className="qt-badge qt-badge-provider-google">Google</span>
          <span className="qt-badge qt-badge-provider-openrouter">OpenRouter</span>
        </div>
      </section>

      {/* Badge with Icons */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Badges with Icons
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <span className="qt-badge qt-badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Complete
          </span>
          <span className="qt-badge qt-badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Warning
          </span>
          <span className="qt-badge qt-badge-destructive" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Error
          </span>
        </div>
      </section>

      {/* Entity Type Badges */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Entity Type Badges
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <span className="qt-badge qt-badge-character">Character</span>
          <span className="qt-badge qt-badge-persona">Persona</span>
          <span className="qt-badge qt-badge-chat">Chat</span>
          <span className="qt-badge qt-badge-tag">Tag</span>
          <span className="qt-badge qt-badge-memory">Memory</span>
        </div>
      </section>

      {/* State Badges */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          State Badges
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <span className="qt-badge qt-badge-enabled">Enabled</span>
          <span className="qt-badge qt-badge-disabled">Disabled</span>
          <span className="qt-badge qt-badge-related">Related</span>
          <span className="qt-badge qt-badge-manual">Manual</span>
          <span className="qt-badge qt-badge-auto">Auto</span>
        </div>
      </section>

      {/* Plugin Source Badges */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Plugin Source Badges
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <span className="qt-badge qt-badge-source-included">Included</span>
          <span className="qt-badge qt-badge-source-npm">NPM</span>
          <span className="qt-badge qt-badge-source-git">Git</span>
          <span className="qt-badge qt-badge-source-manual">Manual</span>
        </div>
      </section>

      {/* Tag Badges */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Tag Badges
        </h3>
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
            Basic tags
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <span className="qt-tag-badge">Fantasy</span>
            <span className="qt-tag-badge">Sci-Fi</span>
            <span className="qt-tag-badge">Romance</span>
          </div>
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
            Emoji tag
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <span className="qt-tag-badge qt-tag-badge-emoji">Adventure</span>
          </div>
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
            Removable tag
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <span className="qt-tag-badge">
              Fantasy
              <button className="qt-tag-badge-remove">×</button>
            </span>
          </div>
        </div>
        <div>
          <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
            Small tags in card context
          </p>
          <div className="qt-card" style={{ maxWidth: '24rem' }}>
            <div className="qt-card-body">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="qt-tag-badge qt-tag-badge-sm">Fantasy</span>
                <span className="qt-tag-badge qt-tag-badge-sm">Sci-Fi</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Badge Usage Examples */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Usage Examples
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="qt-card" style={{ maxWidth: '24rem' }}>
            <div className="qt-card-header">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h4 className="qt-card-title">Feature Name</h4>
                <span className="qt-badge qt-badge-success">Active</span>
              </div>
              <p className="qt-card-description">With status badge</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 500 }}>Notifications</span>
            <span className="qt-badge qt-badge-primary" style={{ borderRadius: '9999px', minWidth: '1.25rem', textAlign: 'center' }}>5</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 500 }}>Version</span>
            <span className="qt-badge qt-badge-outline">v2.5.0</span>
          </div>
        </div>
      </section>
    </div>
  );
};
