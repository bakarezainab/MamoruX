import React from "react";

export function MamoruLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="MamoruX Logo"
    >
      <defs>
        <linearGradient id="mamoru-grad" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00EC97" />
          <stop offset="55%" stopColor="#17D9D4" />
          <stop offset="100%" stopColor="#00B87A" />
        </linearGradient>
        <linearGradient id="mamoru-glass" x1="12" y1="10" x2="52" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1A1A1A" />
          <stop offset="100%" stopColor="#0B0B0B" />
        </linearGradient>
      </defs>

      {/* Outer armored hexagon shield */}
      <path
        d="M32 4L55 15V33C55 46.5 45.2 55.8 32 60C18.8 55.8 9 46.5 9 33V15L32 4Z"
        fill="url(#mamoru-glass)"
        stroke="url(#mamoru-grad)"
        strokeWidth="2.4"
      />

      {/* Inner neural prism */}
      <path
        d="M32 11L48 19.5V32.5C48 42.3 41.1 49.4 32 52.8C22.9 49.4 16 42.3 16 32.5V19.5L32 11Z"
        fill="#00EC97"
        fillOpacity="0.06"
        stroke="#00EC97"
        strokeOpacity="0.25"
        strokeWidth="1"
      />

      {/* Interlocking M + X cipher */}
      <path
        d="M21 40V23L32 33.5L43 23V40"
        stroke="url(#mamoru-grad)"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M23.5 24.5L40.5 41.5M40.5 24.5L23.5 41.5"
        stroke="#FFFFFF"
        strokeOpacity="0.9"
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* Core TEE node */}
      <circle cx="32" cy="33" r="3.2" fill="#00EC97" />
    </svg>
  );
}
