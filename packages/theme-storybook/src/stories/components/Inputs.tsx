/**
 * Inputs Story Component
 *
 * Displays all input variants and states for theme development.
 */

import React from 'react';

export const Inputs: React.FC = () => {
  return (
    <div style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem' }}>Inputs</h2>

      {/* Text Inputs */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Text Inputs
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '24rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
              Default
            </label>
            <input className="qt-input" type="text" placeholder="Enter text..." />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
              With Value
            </label>
            <input className="qt-input" type="text" defaultValue="Sample text" />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
              Disabled
            </label>
            <input className="qt-input" type="text" placeholder="Disabled input" disabled />
          </div>
        </div>
      </section>

      {/* Textarea */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Textarea
        </h3>
        <div style={{ maxWidth: '24rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
            Message
          </label>
          <textarea
            className="qt-input qt-textarea"
            placeholder="Enter your message..."
            style={{ minHeight: '6rem' }}
          />
        </div>
      </section>

      {/* Select */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Select
        </h3>
        <div style={{ maxWidth: '24rem' }}>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
            Choose an option
          </label>
          <select className="qt-input qt-select">
            <option value="">Select an option...</option>
            <option value="1">Option 1</option>
            <option value="2">Option 2</option>
            <option value="3">Option 3</option>
          </select>
        </div>
      </section>

      {/* Form Example */}
      <section>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
          Form Example
        </h3>
        <div className="qt-card" style={{ maxWidth: '24rem' }}>
          <div className="qt-card-header">
            <h4 className="qt-card-title">Contact Form</h4>
            <p className="qt-card-description">Fill out the form below.</p>
          </div>
          <div className="qt-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
                Name
              </label>
              <input className="qt-input" type="text" placeholder="Your name" />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
                Email
              </label>
              <input className="qt-input" type="email" placeholder="you@example.com" />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
                Message
              </label>
              <textarea className="qt-input qt-textarea" placeholder="Your message..." style={{ minHeight: '5rem' }} />
            </div>
          </div>
          <div className="qt-card-footer">
            <button className="qt-button qt-button-ghost">Cancel</button>
            <button className="qt-button qt-button-primary">Send</button>
          </div>
        </div>
      </section>
    </div>
  );
};
