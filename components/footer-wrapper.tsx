'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import packageJson from '@/package.json';
import { showSuccessToast } from '@/lib/toast';

type BackendMode = 'local' | 'Docker' | 'VM';

export default function FooterWrapper() {
  const pathname = usePathname();
  const [backendMode, setBackendMode] = useState<BackendMode | null>(null);
  const [hostPath, setHostPath] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/system/data-dir')
      .then((res) => res.json())
      .then((data) => {
        if (data.isVM) {
          setBackendMode('VM');
        } else if (data.isDocker) {
          setBackendMode('Docker');
        } else {
          setBackendMode('local');
        }
        if (data.hostPath) {
          setHostPath(data.hostPath);
        }
      })
      .catch(() => {
        setBackendMode('local');
      });
  }, []);

  // Hide footer on chat pages - they have their own layout
  const isChatPage = pathname?.match(/^\/salon\/[^/]+$/);

  if (isChatPage) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const copyrightYears = currentYear > 2025 ? `2025-${currentYear}` : "2025";

  return (
    <footer className="qt-footer">
      <div className="qt-footer-container">
        <span>v{packageJson.version}{backendMode ? ` (${backendMode})` : ''}</span>
        {hostPath && (
          <button
            className="qt-footer-path"
            title={window.quilltap?.openPath ? 'Open in file browser' : 'Click to copy path'}
            onClick={() => {
              if (window.quilltap?.openPath) {
                window.quilltap.openPath(hostPath);
              } else {
                const copyText = /[\s"'\\$`!#&|;(){}]/.test(hostPath) ? `"${hostPath}"` : hostPath;
                navigator.clipboard.writeText(copyText).then(() => {
                  showSuccessToast('Path copied to clipboard');
                });
              }
            }}
          >
            {hostPath}
          </button>
        )}
        <span className="qt-footer-separator">•</span>
        <a
          href="https://foundry-9.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="qt-footer-link"
        >
          &copy; {copyrightYears} Foundry-9 LLC
        </a>
      </div>
    </footer>
  );
}
