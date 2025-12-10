"use client";

interface BrandNameProps {
  className?: string;
}

/**
 * Renders "Quilltap" in the brand font (EB Garamond).
 * Use this component wherever the Quilltap name appears in the UI.
 */
export function BrandName({ className = "" }: BrandNameProps) {
  return (
    <span className={`qt-font-brand ${className}`}>
      Quilltap
    </span>
  );
}
