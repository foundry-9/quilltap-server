/**
 * Avatars Story Component
 *
 * Displays all avatar variants and states for theme development.
 */

import React from 'react';

export const Avatars: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Avatars</h2>

      {/* Avatar Sizes */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Avatar Sizes
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="qt-avatar qt-avatar-xs">
            <div className="qt-avatar-fallback">XS</div>
          </div>
          <div className="qt-avatar qt-avatar-sm">
            <div className="qt-avatar-fallback">SM</div>
          </div>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">MD</div>
          </div>
          <div className="qt-avatar qt-avatar-lg">
            <div className="qt-avatar-fallback">LG</div>
          </div>
          <div className="qt-avatar qt-avatar-xl">
            <div className="qt-avatar-fallback">XL</div>
          </div>
        </div>
      </section>

      {/* Avatar with Images */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Avatar with Images
        </h3>
        <p style={{ color: 'var(--color-muted-foreground)', marginBottom: '1rem' }}>
          Avatars gracefully fall back to initials when image is unavailable.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">AB</div>
          </div>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">CD</div>
          </div>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">EF</div>
          </div>
        </div>
      </section>

      {/* Avatar Shapes */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Avatar Shapes
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div>
            <div className="qt-avatar" style={{ borderRadius: '9999px' }}>
              <div className="qt-avatar-fallback">CR</div>
            </div>
            <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-muted-foreground)', textAlign: 'center' }}>Circle</p>
          </div>
          <div>
            <div className="qt-avatar" style={{ borderRadius: 'var(--radius-lg)' }}>
              <div className="qt-avatar-fallback">RD</div>
            </div>
            <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-muted-foreground)', textAlign: 'center' }}>Rounded</p>
          </div>
          <div>
            <div className="qt-avatar" style={{ borderRadius: 'var(--radius-sm)' }}>
              <div className="qt-avatar-fallback">SQ</div>
            </div>
            <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-muted-foreground)', textAlign: 'center' }}>Square</p>
          </div>
        </div>
      </section>

      {/* Avatar with Status */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Avatar with Status
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ position: 'relative' }}>
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">ON</div>
            </div>
            <span className="qt-avatar-status qt-avatar-status-online" />
            <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-muted-foreground)', textAlign: 'center' }}>Online</p>
          </div>
          <div style={{ position: 'relative' }}>
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">AW</div>
            </div>
            <span className="qt-avatar-status qt-avatar-status-away" />
            <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-muted-foreground)', textAlign: 'center' }}>Away</p>
          </div>
          <div style={{ position: 'relative' }}>
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">BS</div>
            </div>
            <span className="qt-avatar-status qt-avatar-status-busy" />
            <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-muted-foreground)', textAlign: 'center' }}>Busy</p>
          </div>
          <div style={{ position: 'relative' }}>
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">OF</div>
            </div>
            <span className="qt-avatar-status qt-avatar-status-offline" />
            <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-muted-foreground)', textAlign: 'center' }}>Offline</p>
          </div>
        </div>
      </section>

      {/* Avatar Groups */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Avatar Groups
        </h3>
        <div className="qt-avatar-group">
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">A</div>
          </div>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">B</div>
          </div>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">C</div>
          </div>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">D</div>
          </div>
          <div className="qt-avatar">
            <div className="qt-avatar-fallback">+3</div>
          </div>
        </div>
      </section>

      {/* Usage in Context */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Usage in Context
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* User list item */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', backgroundColor: 'var(--color-muted)', borderRadius: 'var(--radius-lg)' }}>
            <div className="qt-avatar">
              <div className="qt-avatar-fallback">JD</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>John Doe</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--color-muted-foreground)' }}>john@example.com</div>
            </div>
            <span className="qt-badge qt-badge-success">Active</span>
          </div>
          {/* Comment */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div className="qt-avatar qt-avatar-sm">
              <div className="qt-avatar-fallback">SM</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Sarah Miller</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}>2 hours ago</span>
              </div>
              <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
                This is a sample comment with an avatar.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
