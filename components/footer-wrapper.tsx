'use client';

import { usePathname } from 'next/navigation';
import packageJson from '@/package.json';

export default function FooterWrapper() {
  const pathname = usePathname();

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
        <span>v{packageJson.version}</span>
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
