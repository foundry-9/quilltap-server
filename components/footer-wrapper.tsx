'use client';

import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import packageJson from '@/package.json';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { showSuccessToast } from '@/lib/toast';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

type BackendMode = 'local' | 'Docker' | 'Electron' | 'Electron+Docker';

/** The fields of `GET /api/v1/system/data-dir` the footer reads. */
interface FooterDataDirInfo {
  isDocker?: boolean;
  isElectronShell?: boolean;
  shellVersion?: string;
  hostPath?: string;
}

function backendModeOf(data: FooterDataDirInfo): BackendMode {
  const isShell = data.isElectronShell;
  if (data.isDocker) return isShell ? 'Electron+Docker' : 'Docker';
  return isShell ? 'Electron' : 'local';
}

export default function FooterWrapper() {
  const pathname = usePathname();
  const { copy } = useCopyToClipboard();
  // The same cache entry the Data Directory card reads.
  const { data, isError } = useQuery({
    queryKey: queryKeys.system.dataDir,
    queryFn: ({ signal }) => apiFetch<FooterDataDirInfo>('/api/v1/system/data-dir', { signal }),
  });
  const backendMode: BackendMode | null = data ? backendModeOf(data) : isError ? 'local' : null;
  const shellVersion = data?.isElectronShell && data.shellVersion ? data.shellVersion : null;
  const hostPath = data?.hostPath || null;

  // Hide footer on chat pages - they have their own layout
  const isChatPage = pathname?.match(/^\/salon\/[^/]+$/);

  if (isChatPage) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const copyrightYears = currentYear > 2025 ? `2025-${currentYear}` : "2025";

  return (
    <footer className="qt-footer">
      {/* At phone width, clear the floating Brahma Console launcher. */}
      <div className="qt-footer-container max-sm:pl-14">
        <span>v{packageJson.version}{backendMode ? ` (${backendMode})` : ''}{shellVersion ? ` shell v${shellVersion}` : ''}</span>
        {hostPath && (
          <button
            className="qt-footer-path"
            title={window.quilltap?.openPath ? 'Open in file browser' : 'Click to copy path'}
            onClick={() => {
              if (window.quilltap?.openPath) {
                window.quilltap.openPath(hostPath);
              } else {
                const copyText = /[\s"'\\$`!#&|;(){}]/.test(hostPath) ? `"${hostPath}"` : hostPath;
                void copy(copyText).then((ok) => {
                  if (ok) showSuccessToast('Path copied to clipboard');
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
