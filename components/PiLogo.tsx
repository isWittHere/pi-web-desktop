"use client";

/** Inline Pi logo (same path as public/pi-original.svg). The source uses
 *  fill="currentColor", so the accent/title-bar color comes from the parent. */
export function PiLogo({ size = 16 }: { size?: number }) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      style={{ flex: "none", lineHeight: 1 }}
      aria-hidden="true"
    >
      <path clipRule="evenodd" d="M1 1h16.5v11H12v5.5H6.5V23H1V1zm5.5 5.5V12H12V6.5H6.5z" />
      <path d="M17.5 12H23v11h-5.5V12z" />
    </svg>
  );
}
