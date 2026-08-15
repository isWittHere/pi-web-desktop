"use client";

import { createPortal } from "react-dom";

/**
 * Transparent overlay covering the Electron title bar while a dropdown is
 * open. Chromium swallows mousedown on -webkit-app-region: drag areas, so
 * clicks on the empty title bar never reach the document-level outside-click
 * listener (and flipping the drag region to no-drag is unreliable — the
 * window-level hit-test is cached). The overlay is an ordinary non-drag
 * element, so mousedown on it dispatches normally and the menu dismisses.
 *
 * The gesture is forwarded to any interactive element underneath (title-bar
 * buttons), so one click both dismisses the menu and activates the button —
 * without that, the button would need a second click. Only the 36px title
 * bar is covered; dropdowns render below it and stay clickable.
 */
export function TitleBarDismissOverlay() {
  const forwardGesture = (e: React.MouseEvent<HTMLDivElement>) => {
    const below = document
      .elementsFromPoint(e.clientX, e.clientY)
      .filter((el) => el !== e.currentTarget);
    const interactive = below.find((el): el is HTMLElement =>
      el instanceof HTMLElement
      && (el.tagName === "BUTTON"
        || el.getAttribute("role") === "button"
        || el.classList.contains("app-no-drag"))
    );
    if (!interactive) return;
    // The document mousedown listener closes the menu on this mousedown; the
    // overlay unmounts before mouseup, so defer the click until mouseup and
    // replay it on the element underneath.
    const onMouseUp = () => {
      window.removeEventListener("mouseup", onMouseUp);
      interactive.click();
    };
    window.addEventListener("mouseup", onMouseUp);
  };

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 36,
        zIndex: 601,
        // Electron's draggable regions are area sets, not z-ordered DOM:
        // a click is captured by any drag rectangle regardless of what
        // renders above it. The overlay must explicitly carve itself out
        // of the drag region with no-drag or the mousedown never dispatches.
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
      onMouseDown={forwardGesture}
    />,
    document.body,
  );
}
