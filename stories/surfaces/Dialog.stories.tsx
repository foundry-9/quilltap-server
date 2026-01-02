import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';

/**
 * Dialog and modal stories showing the qt-dialog-* classes.
 */

const DialogShowcase: React.FC = () => {
  const [showDialog, setShowDialog] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-4">Dialog Preview (Inline)</h3>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          This shows the dialog styling without the overlay for preview purposes.
        </p>
        <div className="qt-dialog max-w-md mx-auto">
          <div className="qt-dialog-header">
            <h4 className="qt-dialog-title">Dialog Title</h4>
            <p className="qt-dialog-description">
              This is a description of what this dialog does.
            </p>
          </div>
          <div className="qt-dialog-body">
            <p>Dialog body content goes here. This can contain forms, information, or any other content.</p>
          </div>
          <div className="qt-dialog-footer">
            <button className="qt-button qt-button-ghost">Cancel</button>
            <button className="qt-button qt-button-primary">Confirm</button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Interactive Dialogs</h3>
        <div className="flex gap-4">
          <button className="qt-button qt-button-primary" onClick={() => setShowDialog(true)}>
            Open Dialog
          </button>
          <button className="qt-button qt-button-destructive" onClick={() => setShowConfirm(true)}>
            Delete Item
          </button>
        </div>

        {showDialog && (
          <div className="qt-dialog-overlay" onClick={() => setShowDialog(false)}>
            <div className="qt-dialog max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="qt-dialog-header">
                <h4 className="qt-dialog-title">Edit Profile</h4>
                <p className="qt-dialog-description">
                  Make changes to your profile here.
                </p>
              </div>
              <div className="qt-dialog-body space-y-4">
                <div>
                  <label className="qt-label">Name</label>
                  <input type="text" className="qt-input" defaultValue="John Doe" />
                </div>
                <div>
                  <label className="qt-label">Bio</label>
                  <textarea className="qt-textarea" rows={3} defaultValue="A short bio..." />
                </div>
              </div>
              <div className="qt-dialog-footer">
                <button className="qt-button qt-button-ghost" onClick={() => setShowDialog(false)}>
                  Cancel
                </button>
                <button className="qt-button qt-button-primary" onClick={() => setShowDialog(false)}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {showConfirm && (
          <div className="qt-dialog-overlay" onClick={() => setShowConfirm(false)}>
            <div className="qt-dialog max-w-sm" onClick={(e) => e.stopPropagation()}>
              <div className="qt-dialog-header">
                <h4 className="qt-dialog-title">Confirm Delete</h4>
                <p className="qt-dialog-description">
                  Are you sure you want to delete this item? This action cannot be undone.
                </p>
              </div>
              <div className="qt-dialog-footer">
                <button className="qt-button qt-button-ghost" onClick={() => setShowConfirm(false)}>
                  Cancel
                </button>
                <button className="qt-button qt-button-destructive" onClick={() => setShowConfirm(false)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Popover</h3>
        <div className="relative inline-block">
          <button className="qt-button qt-button-secondary">Hover for popover</button>
          <div className="qt-popover absolute left-0 top-full mt-2" style={{ display: 'block' }}>
            <div className="p-3">
              <p className="font-semibold">Popover Title</p>
              <p className="text-sm text-gray-500">This is popover content.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Dropdown Menu</h3>
        <div className="qt-dropdown inline-block" style={{ display: 'block', position: 'relative' }}>
          <div className="qt-dropdown-item">Profile</div>
          <div className="qt-dropdown-item">Settings</div>
          <div className="qt-dropdown-separator" />
          <div className="qt-dropdown-item text-red-500">Sign Out</div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Tooltip</h3>
        <div className="flex items-center gap-8">
          <div className="relative inline-block">
            <button className="qt-button qt-button-secondary">Hover me</button>
            <div className="qt-tooltip absolute left-1/2 -translate-x-1/2 bottom-full mb-2">
              Tooltip text
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof DialogShowcase> = {
  title: 'Surfaces/Dialog',
  component: DialogShowcase,
};

export default meta;
type Story = StoryObj<typeof DialogShowcase>;

export const AllDialogs: Story = {};

export const BasicDialog: Story = {
  render: () => (
    <div className="qt-dialog max-w-md mx-auto">
      <div className="qt-dialog-header">
        <h4 className="qt-dialog-title">Basic Dialog</h4>
        <p className="qt-dialog-description">A simple dialog example.</p>
      </div>
      <div className="qt-dialog-body">
        <p>Content goes here.</p>
      </div>
      <div className="qt-dialog-footer">
        <button className="qt-button qt-button-primary">OK</button>
      </div>
    </div>
  ),
};

export const ConfirmDialog: Story = {
  render: () => (
    <div className="qt-dialog max-w-sm mx-auto">
      <div className="qt-dialog-header">
        <h4 className="qt-dialog-title">Delete Character?</h4>
        <p className="qt-dialog-description">
          This will permanently delete &quot;Alice&quot; and all associated data. This action cannot be undone.
        </p>
      </div>
      <div className="qt-dialog-footer">
        <button className="qt-button qt-button-ghost">Cancel</button>
        <button className="qt-button qt-button-destructive">Delete</button>
      </div>
    </div>
  ),
};

export const FormDialog: Story = {
  render: () => (
    <div className="qt-dialog max-w-md mx-auto">
      <div className="qt-dialog-header">
        <h4 className="qt-dialog-title">Create Character</h4>
        <p className="qt-dialog-description">Add a new character to your collection.</p>
      </div>
      <div className="qt-dialog-body space-y-4">
        <div>
          <label className="qt-label">Name</label>
          <input type="text" className="qt-input" placeholder="Character name..." />
        </div>
        <div>
          <label className="qt-label">Description</label>
          <textarea className="qt-textarea" rows={3} placeholder="Describe your character..." />
        </div>
      </div>
      <div className="qt-dialog-footer">
        <button className="qt-button qt-button-ghost">Cancel</button>
        <button className="qt-button qt-button-primary">Create</button>
      </div>
    </div>
  ),
};
