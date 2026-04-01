'use client'

import Image from 'next/image'

interface QuillAnimationProps {
  size?: 'lg' | 'sm'
  className?: string
}

export function QuillAnimation({ size = 'lg', className = '' }: QuillAnimationProps) {
  const sizeClasses = size === 'lg'
    ? 'w-12 h-12'
    : 'w-4 h-4'

  const imageSize = size === 'lg' ? 48 : 16

  return (
    <div className={`inline-flex items-center justify-center ${sizeClasses} ${className}`}>
      <Image
        src="/quill.svg"
        alt="Writing..."
        width={imageSize}
        height={imageSize}
        className="animate-quill-rock"
      />

      <style jsx global>{`
        @keyframes quill-rock {
          0% {
            transform: rotate(-45deg);
          }
          50% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(-45deg);
          }
        }

        .animate-quill-rock {
          animation: quill-rock 1.2s ease-in-out infinite;
          transform-origin: center center;
        }
      `}</style>
    </div>
  )
}
