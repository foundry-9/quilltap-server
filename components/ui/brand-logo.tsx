"use client";

import Image from "next/image";
import { BrandName } from "./brand-name";

type BrandLogoSize = "sm" | "md" | "lg" | "xl";

interface BrandLogoProps {
  size?: BrandLogoSize;
  className?: string;
}

const sizeConfig: Record<BrandLogoSize, { quill: number; text: string; overlap: string }> = {
  sm: { quill: 24, text: "text-lg", overlap: "-mr-2" },
  md: { quill: 32, text: "text-xl", overlap: "-mr-2.5" },
  lg: { quill: 48, text: "text-3xl", overlap: "-mr-3" },
  xl: { quill: 96, text: "text-5xl", overlap: "-mr-5" },
};

/**
 * Brand logo combining the quill icon with the Quilltap name.
 * The quill overlaps slightly with the "Q" in Quilltap for a cohesive look.
 */
export function BrandLogo({ size = "md", className = "" }: BrandLogoProps) {
  const config = sizeConfig[size];

  return (
    <span className={`inline-flex items-center ${className}`}>
      <Image
        src="/quill.svg"
        alt=""
        width={config.quill}
        height={config.quill}
        className={`${config.overlap} relative z-10`}
        style={{
          height: `${config.quill}px`,
          width: "auto",
          marginBottom: `${config.quill * 0.15}px`
        }}
        aria-hidden="true"
      />
      <BrandName className={`${config.text} font-bold`} />
    </span>
  );
}
