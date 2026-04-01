import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

/**
 * Input and form control stories showing all variants and states.
 * These use the qt-input, qt-textarea, qt-select classes.
 */

const InputShowcase: React.FC = () => {
  return (
    <div className="space-y-8 max-w-md">
      <section>
        <h3 className="text-lg font-semibold mb-4">Text Inputs</h3>
        <div className="space-y-4">
          <div>
            <label className="qt-label">Default Input</label>
            <input type="text" className="qt-input" placeholder="Enter text..." />
          </div>
          <div>
            <label className="qt-label">With Hint</label>
            <input type="text" className="qt-input" placeholder="Enter email..." />
            <span className="qt-hint">We&apos;ll never share your email.</span>
          </div>
          <div>
            <label className="qt-label">Disabled</label>
            <input type="text" className="qt-input" placeholder="Disabled input" disabled />
          </div>
          <div>
            <label className="qt-label">With Error</label>
            <input type="text" className="qt-input qt-input-error" placeholder="Invalid input" />
            <span className="qt-hint text-red-500">This field is required.</span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Textarea</h3>
        <div className="space-y-4">
          <div>
            <label className="qt-label">Default Textarea</label>
            <textarea className="qt-textarea" placeholder="Enter your message..." rows={4} />
          </div>
          <div>
            <label className="qt-label">Disabled Textarea</label>
            <textarea className="qt-textarea" placeholder="Disabled" rows={3} disabled />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Select</h3>
        <div className="space-y-4">
          <div>
            <label className="qt-label">Default Select</label>
            <select className="qt-select">
              <option>Select an option...</option>
              <option>Option 1</option>
              <option>Option 2</option>
              <option>Option 3</option>
            </select>
          </div>
          <div>
            <label className="qt-label">Disabled Select</label>
            <select className="qt-select" disabled>
              <option>Disabled</option>
            </select>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Checkboxes & Radios</h3>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input type="checkbox" id="check1" className="qt-checkbox" />
            <label htmlFor="check1">Checkbox option</label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="check2" className="qt-checkbox" defaultChecked />
            <label htmlFor="check2">Checked checkbox</label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="check3" className="qt-checkbox" disabled />
            <label htmlFor="check3" className="text-gray-400">Disabled checkbox</label>
          </div>
          <div className="flex items-center gap-2">
            <input type="radio" name="radio" id="radio1" className="qt-radio" />
            <label htmlFor="radio1">Radio option 1</label>
          </div>
          <div className="flex items-center gap-2">
            <input type="radio" name="radio" id="radio2" className="qt-radio" defaultChecked />
            <label htmlFor="radio2">Radio option 2</label>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Links</h3>
        <div className="space-y-2">
          <div>
            <a href="#" className="qt-link">Default link</a>
          </div>
          <div>
            <a href="#" className="qt-link-subtle">Subtle link</a>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof InputShowcase> = {
  title: 'Interactive/Input',
  component: InputShowcase,
};

export default meta;
type Story = StoryObj<typeof InputShowcase>;

export const AllInputs: Story = {};

export const TextInput: Story = {
  render: () => (
    <div className="max-w-md">
      <label className="qt-label">Username</label>
      <input type="text" className="qt-input" placeholder="Enter username..." />
      <span className="qt-hint">Choose a unique username.</span>
    </div>
  ),
};

export const TextInputWithError: Story = {
  render: () => (
    <div className="max-w-md">
      <label className="qt-label">Email</label>
      <input type="email" className="qt-input qt-input-error" defaultValue="invalid-email" />
      <span className="qt-hint text-red-500">Please enter a valid email address.</span>
    </div>
  ),
};

export const Textarea: Story = {
  render: () => (
    <div className="max-w-md">
      <label className="qt-label">Message</label>
      <textarea className="qt-textarea" placeholder="Type your message..." rows={4} />
    </div>
  ),
};

export const Select: Story = {
  render: () => (
    <div className="max-w-md">
      <label className="qt-label">Country</label>
      <select className="qt-select">
        <option>Select a country...</option>
        <option>United States</option>
        <option>Canada</option>
        <option>United Kingdom</option>
        <option>Australia</option>
      </select>
    </div>
  ),
};
