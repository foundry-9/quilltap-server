'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const STORAGE_KEY = 'quilltap_2fa_prompt_dismissed'

interface TwoFactorStatus {
  totpEnabled: boolean
  hasBackupCodes: boolean
  enabledAt: string | null
}

export function TwoFactorPrompt() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [dismissed, setDismissed] = useState(true) // Start hidden until we check
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check localStorage for dismissal
    const wasDismissed = localStorage.getItem(STORAGE_KEY)
    if (wasDismissed) {
      setDismissed(true)
      setLoading(false)
      return
    }

    // Fetch 2FA status
    async function checkStatus() {
      try {
        const res = await fetch('/api/auth/2fa/status')
        if (res.ok) {
          const data = await res.json()
          setStatus(data)
          // Only show prompt if 2FA is not enabled
          setDismissed(data.totpEnabled)
        }
      } catch (err) {
        console.error('Failed to check 2FA status:', err)
        // On error, hide the prompt
        setDismissed(true)
      } finally {
        setLoading(false)
      }
    }

    checkStatus()
  }, [])

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    setDismissed(true)
  }

  // Don't render anything while loading or if dismissed/enabled
  if (loading || dismissed || status?.totpEnabled) {
    return null
  }

  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-amber-600 dark:text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Secure your account with two-factor authentication
            </h3>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
              Add an extra layer of security by requiring a code from your authenticator app when signing in.
            </p>
            <div className="mt-3">
              <Link
                href="/profile"
                className="inline-flex items-center rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
              >
                Enable 2FA
                <svg
                  className="ml-1.5 h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </div>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 rounded p-1 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
          aria-label="Dismiss"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
