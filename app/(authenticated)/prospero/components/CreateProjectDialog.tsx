'use client'

/**
 * Create Project Dialog
 *
 * Modal dialog for creating a new project.
 */

interface CreateProjectDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (name: string, description: string | null) => void
}

export function CreateProjectDialog({ open, onClose, onSubmit }: CreateProjectDialogProps) {
  if (!open) return null

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string

    onSubmit(name, description || null)
  }

  return (
    <div className="qt-dialog-overlay p-4">
      <div className="qt-dialog max-w-md p-6">
        <h3 className="qt-dialog-title mb-4">Create Project</h3>
        <form onSubmit={handleSubmit}>
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
          <div className="mb-4">
            <label className="qt-label mb-2 block">Description (optional)</label>
            <textarea
              name="description"
              maxLength={2000}
              rows={3}
              placeholder="What is this project about?"
              className="qt-textarea"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="qt-button-secondary">
              Cancel
            </button>
            <button type="submit" className="qt-button-primary">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
