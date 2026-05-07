'use client';

import { useRouter } from 'next/navigation';
import { use, useCallback } from 'react';
import { Terminal } from '@/components/terminal/Terminal';
import { useTerminalSession } from '@/hooks/useTerminalSession';
import { showErrorToast } from '@/lib/toast';

interface TerminalPopoutPageProps {
  params: Promise<{ id: string; sessionId: string }>;
}

export default function TerminalPopoutPage({ params }: TerminalPopoutPageProps) {
  const { id: chatId, sessionId } = use(params);
  const router = useRouter();
  const session = useTerminalSession(sessionId);

  const handleKill = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/terminals/${sessionId}?action=kill`, {
        method: 'POST',
      });

      if (!res.ok) {
        showErrorToast('Failed to terminate session');
      }
    } catch {
      showErrorToast('Failed to terminate session');
    }
  }, [sessionId]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const title = session.meta?.label || (session.meta ? `Terminal — ${session.meta.shell}` : 'Terminal');

  return (
    <div className="h-screen flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="qt-icon-button"
            title="Back to chat"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <a
            href={`/salon/${chatId}`}
            className="text-white hover:underline text-sm"
          >
            Chat
          </a>
          <span className="text-gray-500">/</span>
          <h1 className="text-white font-medium">{title}</h1>
        </div>

        {session.state !== 'exited' && (
          <button
            onClick={handleKill}
            className="qt-button-destructive text-sm"
          >
            Kill Session
          </button>
        )}
      </div>

      {/* Terminal Body */}
      <div className="flex-1 overflow-hidden">
        <Terminal
          sessionId={sessionId}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
