import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Typography system visualization for theme development.
 * Shows headings, body text, and special text styles.
 */

const Typography: React.FC = () => {
  return (
    <div className="p-6 space-y-12">
      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Headings (qt-heading-*)</h2>
        <div className="space-y-4">
          <div>
            <h1 className="qt-heading-1">Heading 1 - The quick brown fox</h1>
            <code className="text-xs text-gray-500">.qt-heading-1</code>
          </div>
          <div>
            <h2 className="qt-heading-2">Heading 2 - The quick brown fox</h2>
            <code className="text-xs text-gray-500">.qt-heading-2</code>
          </div>
          <div>
            <h3 className="qt-heading-3">Heading 3 - The quick brown fox</h3>
            <code className="text-xs text-gray-500">.qt-heading-3</code>
          </div>
          <div>
            <h4 className="qt-heading-4">Heading 4 - The quick brown fox</h4>
            <code className="text-xs text-gray-500">.qt-heading-4</code>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Body Text</h2>
        <div className="space-y-6">
          <div>
            <p className="qt-text-lead">
              Lead text - Used for introductory paragraphs that need more emphasis.
              The quick brown fox jumps over the lazy dog.
            </p>
            <code className="text-xs text-gray-500">.qt-text-lead</code>
          </div>
          <div>
            <p className="qt-text-large">
              Large text - Slightly larger than body text for emphasis.
              The quick brown fox jumps over the lazy dog.
            </p>
            <code className="text-xs text-gray-500">.qt-text-large</code>
          </div>
          <div>
            <p>
              Default body text - The standard text size for most content.
              The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.
            </p>
            <code className="text-xs text-gray-500">default / no class</code>
          </div>
          <div>
            <p className="qt-text-small">
              Small text - For less important or supplementary information.
              The quick brown fox jumps over the lazy dog.
            </p>
            <code className="text-xs text-gray-500">.qt-text-small</code>
          </div>
          <div>
            <p className="qt-text-xs">
              Extra small text - For fine print, captions, or metadata.
              The quick brown fox jumps over the lazy dog.
            </p>
            <code className="text-xs text-gray-500">.qt-text-xs</code>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Text Colors</h2>
        <div className="space-y-4">
          <div>
            <p>Default text color</p>
            <code className="text-xs text-gray-500">default</code>
          </div>
          <div>
            <p className="qt-text-muted">Muted text - For secondary content</p>
            <code className="text-xs text-gray-500">.qt-text-muted</code>
          </div>
          <div>
            <p className="qt-text-primary">Primary text - For emphasis and links</p>
            <code className="text-xs text-gray-500">.qt-text-primary</code>
          </div>
          <div>
            <p className="qt-text-success">Success text - For positive messages</p>
            <code className="text-xs text-gray-500">.qt-text-success</code>
          </div>
          <div>
            <p className="qt-text-warning">Warning text - For caution messages</p>
            <code className="text-xs text-gray-500">.qt-text-warning</code>
          </div>
          <div>
            <p className="qt-text-destructive">Destructive text - For error messages</p>
            <code className="text-xs text-gray-500">.qt-text-destructive</code>
          </div>
          <div>
            <p className="qt-text-info">Info text - For informational messages</p>
            <code className="text-xs text-gray-500">.qt-text-info</code>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Labels & UI Text</h2>
        <div className="space-y-4">
          <div>
            <span className="qt-label">Form Label</span>
            <code className="text-xs text-gray-500 ml-4">.qt-label</code>
          </div>
          <div>
            <span className="qt-hint">Hint text for form fields</span>
            <code className="text-xs text-gray-500 ml-4">.qt-hint</code>
          </div>
          <div>
            <span className="qt-text-label">UI Label Text</span>
            <code className="text-xs text-gray-500 ml-4">.qt-text-label</code>
          </div>
          <div>
            <span className="qt-text-section">Section Header</span>
            <code className="text-xs text-gray-500 ml-4">.qt-text-section</code>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Code & Monospace</h2>
        <div className="space-y-4">
          <div>
            <code className="qt-code-inline">inline code example</code>
            <span className="text-xs text-gray-500 ml-4">.qt-code-inline</span>
          </div>
          <div>
            <pre className="qt-code-block">
{`function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));`}
            </pre>
            <code className="text-xs text-gray-500">.qt-code-block</code>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Prose (Long-form Content)</h2>
        <div className="qt-prose max-w-prose">
          <h3>Article Title</h3>
          <p>
            This is an example of the <code>.qt-prose</code> class applied to a container.
            It provides sensible defaults for long-form content like articles, documentation,
            and chat messages.
          </p>
          <p>
            The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.
            How vexingly quick daft zebras jump! The five boxing wizards jump quickly.
          </p>
          <h4>Subsection</h4>
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
            exercitation ullamco laboris.
          </p>
        </div>
        <code className="text-xs text-gray-500">.qt-prose</code>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 border-b pb-2">Font Families</h2>
        <div className="space-y-4">
          <div>
            <p style={{ fontFamily: 'var(--font-sans)' }}>
              Sans-serif (--font-sans): The quick brown fox jumps over the lazy dog.
            </p>
          </div>
          <div>
            <p style={{ fontFamily: 'var(--font-serif)' }}>
              Serif (--font-serif): The quick brown fox jumps over the lazy dog.
            </p>
          </div>
          <div>
            <p style={{ fontFamily: 'var(--font-mono)' }}>
              Monospace (--font-mono): The quick brown fox jumps over the lazy dog.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof Typography> = {
  title: 'Foundations/Typography',
  component: Typography,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof Typography>;

export const AllTypography: Story = {};
