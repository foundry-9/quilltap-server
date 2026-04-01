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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-semibold text-foreground">Create Project</h3>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="mb-2 block text-sm qt-text-primary">Name</label>
            <input
              type="text"
              name="name"
              required
              maxLength={100}
              placeholder="My Project"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="mb-4">
            <label className="mb-2 block text-sm qt-text-primary">Description (optional)</label>
            <textarea
              name="description"
              maxLength={2000}
              rows={3}
              placeholder="What is this project about?"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm qt-text-primary shadow-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
