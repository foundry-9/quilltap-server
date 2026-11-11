'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '@/components/ui/icon'
import { BaseModal } from '@/components/ui/BaseModal'
import { QtapLink } from '@/components/qtap/QtapLink'
import { isQtapUri } from '@/lib/doc-edit/qtap-uri'
import { ALMANACK_TITLE } from '@/lib/tools/almanack/phases'

interface CapabilitiesReportDialogProps {
  isOpen: boolean
  onClose: () => void
  reportId: string
  filename: string
  content: string
}

export function CapabilitiesReportDialog({
  isOpen,
  onClose,
  reportId,
  filename,
  content,
}: CapabilitiesReportDialogProps) {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={filename}
      subtitle={ALMANACK_TITLE}
      showCloseButton
      maxWidth="6xl"
      className="w-full h-[90vh]"
      bodyClassName="qt-dialog-body flex-1 overflow-y-auto min-h-0"
      footerClassName="qt-dialog-footer flex-shrink-0 flex justify-end gap-3"
      footer={
        <>
          <a
            href={`/api/v1/system/tools?action=capabilities-report-get&reportId=${reportId}&download=true`}
            download={filename}
            className="qt-button qt-button-secondary"
          >
            <Icon name="download" className="w-4 h-4" />
            Download
          </a>
          <button type="button" onClick={onClose} className="qt-button qt-button-primary">
            Close
          </button>
        </>
      }
    >
      <div className="prose prose-sm qt-prose-auto max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              if (isQtapUri(href)) {
                return <QtapLink href={href}>{children}</QtapLink>
              }
              return <a href={href}>{children}</a>
            },
            // Custom table styling
            table: ({ children }) => (
              <div className="overflow-x-auto my-4">
                <table className="min-w-full border-collapse border qt-border-default">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="qt-bg-muted">{children}</thead>
            ),
            th: ({ children }) => (
              <th className="border qt-border-default px-3 py-2 text-left font-semibold">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border qt-border-default px-3 py-2">
                {children}
              </td>
            ),
            // Custom heading styling
            h1: ({ children }) => (
              <h1 className="qt-heading-2 mt-6 mb-4 pb-2 border-b qt-border-default">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="qt-heading-3 mt-6 mb-3 pb-1 border-b qt-border-default">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="qt-heading-4 mt-4 mb-2">
                {children}
              </h3>
            ),
            h4: ({ children }) => (
              <h4 className="text-base font-semibold mt-3 mb-2">
                {children}
              </h4>
            ),
            // List styling
            ul: ({ children }) => (
              <ul className="list-disc list-inside my-2 space-y-1">
                {children}
              </ul>
            ),
            li: ({ children }) => (
              <li className="ml-2">{children}</li>
            ),
            // Code styling
            code: ({ children, className }) => {
              const isInline = !className
              if (isInline) {
                return (
                  <code className="qt-bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                    {children}
                  </code>
                )
              }
              return (
                <code className={className}>{children}</code>
              )
            },
            // Paragraph styling
            p: ({ children }) => (
              <p className="my-2 leading-relaxed">{children}</p>
            ),
            // Strong styling
            strong: ({ children }) => (
              <strong className="font-semibold">{children}</strong>
            ),
            // Emphasis styling
            em: ({ children }) => (
              <em className="italic qt-text-small">{children}</em>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </BaseModal>
  )
}
