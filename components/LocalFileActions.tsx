"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { isImagePath, isVideoPath } from "@/lib/file-types";

interface Props {
  filePath: string;
  sourceSessionId?: string;
  onOpenFile?: (filePath: string) => void;
  className?: string;
  children: ReactNode;
}

const MENU_WIDTH = 210;

export function LocalFileActions({ filePath, sourceSessionId, onOpenFile, className, children }: Props) {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [inlineOpen, setInlineOpen] = useState(false);
  const isImage = isImagePath(filePath);
  const isVideo = isVideoPath(filePath);
  const canPreviewInline = isImage || isVideo;
  const query = new URLSearchParams({ type: "read" });
  if (sourceSessionId) query.set("sessionId", sourceSessionId);
  const previewUrl = `/api/files/${encodeFilePathForApi(filePath)}?${query}`;

  useEffect(() => {
    if (!menuPos) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setMenuPos(null);
    };
    const dismiss = () => setMenuPos(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menuPos]);

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)),
      top: Math.min(rect.bottom + 6, window.innerHeight - 190),
    });
  };

  const openInBrowser = async () => {
    const url = new URL(previewUrl, window.location.href).toString();
    if (window.piDesktop?.openExternal) await window.piDesktop.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
    setMenuPos(null);
  };

  const actionStyle = {
    display: "block",
    width: "100%",
    padding: "7px 10px",
    border: "none",
    borderRadius: 5,
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left" as const,
  };

  return (
    <span style={{ display: "inline-block", maxWidth: "100%" }}>
      <span
        ref={triggerRef}
        className={className}
        title={filePath}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={menuPos !== null}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); openMenu(); }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          openMenu();
        }}
        style={{ color: "inherit", cursor: "pointer", maxWidth: "100%" }}
      >
        {children}
      </span>

      {inlineOpen && canPreviewInline && (
        <span style={{ display: "block", margin: "8px 0" }}>
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={filePath} style={{ display: "block", maxWidth: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 6 }} />
          ) : (
            <video src={previewUrl} controls playsInline preload="metadata" style={{ display: "block", width: "min(720px, 100%)", maxHeight: 420, background: "#000", borderRadius: 6 }} />
          )}
        </span>
      )}

      {menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: "fixed",
            left: menuPos.left,
            top: menuPos.top,
            width: MENU_WIDTH,
            zIndex: 2000,
            padding: 5,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-panel)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
          }}
        >
          {canPreviewInline && (
            <button role="menuitem" type="button" style={actionStyle} onClick={() => { setInlineOpen((value) => !value); setMenuPos(null); }}>
              {inlineOpen ? t("desktop.collapse") : t("desktop.previewInChat")}
            </button>
          )}
          {onOpenFile && (
            <button role="menuitem" type="button" style={actionStyle} onClick={() => { onOpenFile(filePath); setMenuPos(null); }}>
              {t("desktop.openInRightPanel")}
            </button>
          )}
          <button role="menuitem" type="button" style={actionStyle} onClick={() => void openInBrowser()}>
            {t("desktop.openInBrowser")}
          </button>
          <button role="menuitem" type="button" style={actionStyle} onClick={() => { void copyText(filePath); setMenuPos(null); }}>
            {t("desktop.copyFilePath")}
          </button>
          {window.piDesktop?.showItemInFolder && (
            <button role="menuitem" type="button" style={actionStyle} onClick={() => { void window.piDesktop?.showItemInFolder(filePath); setMenuPos(null); }}>
              {t("desktop.revealInFolder")}
            </button>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}
