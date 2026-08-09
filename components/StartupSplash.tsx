"use client";

import { useEffect, useState } from "react";

/**
 * Full-window startup splash. Rendered by React into the server HTML (client
 * components are SSR'd by Next.js), so the Pi logo is visible from the very
 * first paint of the main window — before the JS bundle finishes loading and
 * React hydrates. It unmounts itself via React once the first frame is
 * painted, which avoids any manual DOM manipulation conflicts. While visible
 * it covers the whole viewport and blocks interaction with the not-yet-ready
 * UI.
 */
export function StartupSplash() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(false));
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "#1a1a1a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 26,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="#ffffff"
        fillRule="evenodd"
        width={88}
        height={88}
        xmlns="http://www.w3.org/2000/svg"
        style={{ animation: "pi-splash-breathe 1.7s ease-in-out infinite" }}
      >
        <path clipRule="evenodd" d="M1 1h16.5v11H12v5.5H6.5V23H1V1zm5.5 5.5V12H12V6.5H6.5z" />
        <path d="M17.5 12H23v11h-5.5V12z" />
      </svg>
    </div>
  );
}
