'use client'

/**
 * Create Project Dialog
 *
 * Modal dialog for creating a new project. Renders through BaseModal so it
 * portals to document.body and overlays everything, rather than getting trapped
 * in the qt-page-container stacking context.
 */

import { BaseModal } from '@/components/ui/BaseModal'

interface CreateProjectDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (name: string, description: string | null) => void
}

const FORM_ID = 'create-project-form'

export function CreateProjectDialog({ open, onClose, onSubmit }: CreateProjectDialogProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string

    onSubmit(name, description || null)
  }

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      title="Create Project"
      maxWidth="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="qt-button-secondary">
            Cancel
          </button>
          <button type="submit" form={FORM_ID} className="qt-button-primary">
            Create
          </button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="qt-label mb-2 block">Name</label>
          <input
            type="text"
            name="name"
            required
            maxLength={100}
            placeholder="My Project"
            className="qt-input"
          />
        </div>
        <div>
          <label className="qt-label mb-2 block">Description (optional)</label>
          <textarea
            name="description"
            maxLength={2000}
            rows={3}
            placeholder="What is this project about?"
            className="qt-textarea"
          />
        </div>
      </form>
    </BaseModal>
  )
}
