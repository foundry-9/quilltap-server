'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewPersonaPage() {
 const router = useRouter()
 const [loading, setLoading] = useState(false)
 const [error, setError] = useState<string | null>(null)

 const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault()
  setLoading(true)
  setError(null)

  const formData = new FormData(e.currentTarget)
  const data = {
   name: formData.get('name') as string,
   title: formData.get('title') as string,
   description: formData.get('description') as string,
   personalityTraits: formData.get('personalityTraits') as string,
  }

  try {
   const response = await fetch('/api/personas', {
    method: 'POST',
    headers: {
     'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
   })

   if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create persona')
   }

   const persona = await response.json()
   router.push(`/personas/${persona.id}`)
  } catch (err: any) {
   setError(err.message)
  } finally {
   setLoading(false)
  }
 }

 return (
  <div className="persona-edit container mx-auto max-w-5xl px-4 py-8 text-foreground">
   <div className="mb-8">
    <Link
     href="/personas"
     className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80"
    >
     ← Back to personas
    </Link>
    <h1 className="text-3xl font-semibold text-foreground">Create New Persona</h1>
    <p className="mt-2 qt-text-small">
     Create a user persona to represent yourself in roleplay chats
    </p>
   </div>

   {error && (
    <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
     {error}
    </div>
   )}

  <form onSubmit={handleSubmit} className="persona-section-card space-y-6 rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm">
    <div>
     <label
      htmlFor="name"
      className="block qt-text-label-xs mb-2"
     >
      Name *
     </label>
     <input
      type="text"
      id="name"
      name="name"
      required
      className="block w-full rounded-lg border border-border bg-card px-4 py-2 text-foreground shadow-sm focus:border-ring focus:ring-ring"
      placeholder="Your character's name"
     />
    </div>

    <div>
     <label
      htmlFor="title"
      className="block qt-text-label-xs mb-2"
     >
      Title
     </label>
     <input
      type="text"
      id="title"
      name="title"
      className="block w-full rounded-lg border border-border bg-card px-4 py-2 text-foreground shadow-sm focus:border-ring focus:ring-ring"
      placeholder="e.g., The Wanderer, Knight of the Realm"
     />
    </div>

    <div>
     <label
      htmlFor="description"
      className="block qt-text-label-xs mb-2"
     >
      Description *
     </label>
     <textarea
      id="description"
      name="description"
      required
      rows={4}
      className="block w-full rounded-lg border border-border bg-card px-4 py-2 text-foreground shadow-sm focus:border-ring focus:ring-ring"
      placeholder="Describe your persona (appearance, background, etc.)"
     />
    </div>

    <div>
     <label
      htmlFor="personalityTraits"
      className="block qt-text-label-xs mb-2"
     >
      Personality Traits
     </label>
     <textarea
      id="personalityTraits"
      name="personalityTraits"
      rows={3}
      className="block w-full rounded-lg border border-border bg-card px-4 py-2 text-foreground shadow-sm focus:border-ring focus:ring-ring"
      placeholder="List personality traits (e.g., friendly, curious, adventurous)"
     />
    </div>

    <div className="flex gap-4 pt-4">
     <button
      type="submit"
      disabled={loading}
      className="flex-1 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
     >
      {loading ? 'Creating...' : 'Create Persona'}
     </button>
     <Link
      href="/personas"
      className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium qt-text-small shadow-sm transition hover:bg-muted"
     >
      Cancel
     </Link>
    </div>
   </form>
  </div>
 )
}
