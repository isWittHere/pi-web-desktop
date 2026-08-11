"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CaretRight, Check } from "@phosphor-icons/react";
import { cssPx, cssViewportSize } from "@/lib/ui-scale";

export interface ContextMenuItem {
  /** Discriminant for the menu-entry union; callers never need to set it. */
  type?: "item";
  label: string;
  icon?: ReactNode;
  /** Render the label in the danger color (e.g. destructive actions). */
  danger?: boolean;
  disabled?: boolean;
  /**
   * When set, selecting the item keeps the menu open and briefly shows this
   * label in place of `label` (e.g. "Copied" after a copy action), then the
   * menu closes itself.
   */
  feedbackLabel?: string;
  /** Show a check mark in the icon slot (e.g. the currently active option). */
  checked?: boolean;
  /**
   * One level of nested options, rendered as a flyout submenu on hover/click.
   * Selecting the parent opens (or closes) the submenu instead of acting.
   * Nested submenus are not rendered, so the type forbids them.
   */
  submenu?: Omit<ContextMenuItem, "submenu">[];
  onSelect?: () => void | Promise<void>;
}

export type ContextMenuEntry = ContextMenuItem | { type: "separator" };

interface MenuState {
  x: number;
  y: number;
  entries: ContextMenuEntry[];
}

interface ContextMenuApi {
  openMenu: (x: number, y: number, entries: ContextMenuEntry[]) => void;
  closeMenu: () => void;
}

const ContextMenuContext = createContext<ContextMenuApi | null>(null);

const MENU_ANIMATION_MS = 120;
const MENU_MARGIN = 6;
const FEEDBACK_MS = 1200;

export function useContextMenu(): ContextMenuApi {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) {
    throw new Error("useContextMenu must be used within a <ContextMenuProvider>");
  }
  return ctx;
}

/**
 * Generic right-click (context) menu. Renders into a portal on document.body
 * so it always floats above every panel/stacking context. Any component under
 * the provider can open it via `useContextMenu().openMenu(x, y, entries)`.
 *
 * Behavior: follows the pointer, flips at viewport edges, closes on outside
 * click / Escape / user scroll (wheel/touch) / window blur / resize, and
 * supports basic keyboard navigation (↑/↓, Enter, Space). Programmatic
 * auto-scroll (e.g. streaming chat) does not dismiss it.
 */
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [feedbackIndex, setFeedbackIndex] = useState(-1);
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  const [submenuActiveIndex, setSubmenuActiveIndex] = useState(-1);
  const [submenuFlipped, setSubmenuFlipped] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeMenu = useCallback(() => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
    setFeedbackIndex(-1);
    setActiveIndex(-1);
    setSubmenuIndex(null);
    setSubmenuActiveIndex(-1);
    setSubmenuFlipped(false);
    setVisible(false);
    setPos(null);
    setMenu(null);
  }, []);

  const openMenu = useCallback((x: number, y: number, entries: ContextMenuEntry[]) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
    setFeedbackIndex(-1);
    setActiveIndex(-1);
    setSubmenuIndex(null);
    setSubmenuActiveIndex(-1);
    setSubmenuFlipped(false);
    // Callers pass physical mouse coords (clientX/clientY); the fixed overlay
    // positions in CSS pixels that zoom paints at scale, so convert once here.
    setMenu({ x: cssPx(x), y: cssPx(y), entries });
    setVisible(false);
    // Double rAF: mount first, then animate the fade/scale in.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
  }, []);

  const selectItem = useCallback((index: number, item: ContextMenuItem) => {
    if (item.disabled) return;
    // Items with a submenu act as toggles: selecting opens/closes the flyout.
    if (item.submenu) {
      setSubmenuIndex((cur) => (cur === index ? null : index));
      setSubmenuActiveIndex(-1);
      return;
    }
    if (item.feedbackLabel) {
      setFeedbackIndex(index);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = setTimeout(() => closeMenu(), FEEDBACK_MS);
      void Promise.resolve(item.onSelect?.());
    } else {
      closeMenu();
      void Promise.resolve(item.onSelect?.());
    }
  }, [closeMenu]);

  /** Select an item inside the open submenu (feedback labels unsupported there). */
  const selectSubmenuItem = useCallback((item: ContextMenuItem) => {
    if (item.disabled) return;
    closeMenu();
    void Promise.resolve(item.onSelect?.());
  }, [closeMenu]);

  // Flip the menu back into the viewport once mounted. Runs before paint, so
  // the menu never flashes at an off-screen position.
  useLayoutEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    const el = menuRef.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    let x = menu.x;
    let y = menu.y;
    const { width: vw, height: vh } = cssViewportSize();
    if (x + width > vw - MENU_MARGIN) {
      x = Math.max(MENU_MARGIN, vw - width - MENU_MARGIN);
    }
    if (y + height > vh - MENU_MARGIN) {
      y = Math.max(MENU_MARGIN, vh - height - MENU_MARGIN);
    }
    setPos({ x, y });
  }, [menu]);

  // Flip the submenu back into the viewport once mounted. Runs before paint,
  // so it never flashes off-screen.
  useLayoutEffect(() => {
    if (submenuIndex === null) {
      setSubmenuFlipped(false);
      return;
    }
    const el = submenuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSubmenuFlipped(rect.right > cssViewportSize().width - MENU_MARGIN);
  }, [submenuIndex, menu]);

  // Close on user-initiated gestures while open: outside mousedown (also
  // covers scrollbar drags), wheel/touch scroll, window blur and resize.
  // Deliberately NOT on generic `scroll` events — programmatic auto-scroll
  // (e.g. the chat list following streaming output) would otherwise dismiss
  // the menu on every streamed token.
  useEffect(() => {
    if (!menu) return;
    const isInsideMenu = (target: EventTarget | null) =>
      menuRef.current?.contains(target as Node) ?? false;
    const onPointerDown = (e: MouseEvent) => {
      if (isInsideMenu(e.target)) return;
      closeMenu();
    };
    const onWheel = (e: WheelEvent) => {
      if (isInsideMenu(e.target)) return;
      closeMenu();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (isInsideMenu(e.target)) return;
      closeMenu();
    };
    const onBlur = () => closeMenu();
    const onResize = () => closeMenu();
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("touchmove", onTouchMove, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
    };
  }, [menu, closeMenu]);

  // Keyboard navigation while open. A flyout submenu takes over the keyboard.
  useEffect(() => {
    if (!menu || submenuIndex !== null) return;
    const enabledIndices = () => menu.entries
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => entry.type !== "separator" && !entry.disabled)
      .map(({ i }) => i);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const indices = enabledIndices();
        if (indices.length === 0) return;
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const cur = activeIndex >= 0 ? indices.indexOf(activeIndex) : -1;
        const next = (cur + dir + indices.length) % indices.length;
        setActiveIndex(indices[next]);
        return;
      }
      if (e.key === "ArrowRight") {
        const idx = activeIndex >= 0 ? activeIndex : -1;
        if (idx < 0) return;
        const entry = menu.entries[idx];
        if (entry.type !== "separator" && entry.submenu) {
          e.preventDefault();
          setSubmenuIndex(idx);
          setSubmenuActiveIndex(-1);
        }
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        const indices = enabledIndices();
        if (indices.length === 0) return;
        const idx = activeIndex >= 0 ? activeIndex : indices[0];
        const entry = menu.entries[idx];
        if (entry.type !== "separator") {
          e.preventDefault();
          selectItem(idx, entry);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [menu, activeIndex, submenuIndex, closeMenu, selectItem]);

  // Keyboard navigation inside an open submenu (Escape/← closes it).
  useEffect(() => {
    if (!menu || submenuIndex === null) return;
    const parentEntry = menu.entries[submenuIndex];
    if (parentEntry.type === "separator" || !parentEntry.submenu) return;
    const items = parentEntry.submenu;
    const enabled = items
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => !item.disabled)
      .map(({ i }) => i);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "ArrowLeft") {
        e.preventDefault();
        setSubmenuIndex(null);
        setSubmenuActiveIndex(-1);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (enabled.length === 0) return;
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const cur = submenuActiveIndex >= 0 ? enabled.indexOf(submenuActiveIndex) : -1;
        const next = (cur + dir + enabled.length) % enabled.length;
        setSubmenuActiveIndex(enabled[next]);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        const idx = submenuActiveIndex >= 0 ? submenuActiveIndex : enabled[0];
        const item = items[idx];
        if (item) {
          e.preventDefault();
          selectSubmenuItem(item);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [menu, submenuIndex, submenuActiveIndex, selectSubmenuItem]);

  const api = useMemo<ContextMenuApi>(() => ({ openMenu, closeMenu }), [openMenu, closeMenu]);

  // Y-offset of every entry inside the menu body, used to anchor the flyout
  // submenu next to its parent row (28px rows + 1px separators + 8px margins).
  const topOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 4; // container padding
    for (const entry of menu?.entries ?? []) {
      offsets.push(acc);
      acc += entry.type === "separator" ? 9 : 28;
    }
    return offsets;
  }, [menu]);

  const menuBody = menu ? (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      onMouseLeave={() => {
        // Leaving the whole menu (rows + flyout) dismisses the flyout.
        setSubmenuIndex(null);
        setSubmenuActiveIndex(-1);
      }}
      style={{
        position: "fixed",
        left: pos?.x ?? menu.x,
        top: pos?.y ?? menu.y,
        zIndex: 1000,
        minWidth: 200,
        maxWidth: 300,
        padding: 4,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.16)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-4px) scale(0.98)",
        transformOrigin: "top left",
        transition: `opacity ${MENU_ANIMATION_MS}ms ease, transform ${MENU_ANIMATION_MS}ms ease`,
        pointerEvents: visible ? "auto" : "none",
        userSelect: "none",
        outline: "none",
      }}
    >
      {menu.entries.map((entry, index) => {
        if (entry.type === "separator") {
          return (
            <div
              key={`sep-${index}`}
              role="separator"
              style={{ height: 1, margin: "4px -4px", background: "var(--border)" }}
            />
          );
        }
        const item = entry;
        const disabled = item.disabled ?? false;
        const active = activeIndex === index;
        const showingFeedback = feedbackIndex === index;
        const hasSubmenu = item.submenu !== undefined;
        return (
          <div
            key={index}
            role="menuitem"
            aria-disabled={disabled || undefined}
            aria-haspopup={hasSubmenu ? "menu" : undefined}
            onClick={() => selectItem(index, item)}
            onMouseEnter={() => {
              if (disabled) return;
              setActiveIndex(index);
              // Flyout opens as soon as the pointer lands on its parent row.
              if (hasSubmenu) {
                setSubmenuIndex(index);
                setSubmenuActiveIndex(-1);
              }
            }}
            onMouseLeave={() => { if (activeIndex === index) setActiveIndex(-1); }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 28,
              padding: "0 8px",
              borderRadius: 5,
              cursor: disabled ? "default" : "pointer",
              background: active ? "var(--bg-hover)" : "transparent",
              color: disabled ? "var(--text-dim)" : item.danger ? "#ef4444" : "var(--text)",
              fontSize: 12,
              whiteSpace: "nowrap",
              opacity: disabled ? 0.55 : 1,
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: disabled ? "inherit" : item.danger ? "#ef4444" : "var(--text-dim)",
              }}
            >
              {showingFeedback ? (
                <Check size={13} weight="bold" aria-hidden="true" />
              ) : item.checked ? (
                <Check size={13} weight="bold" color="var(--accent)" aria-hidden="true" />
              ) : (
                item.icon
              )}
            </span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {showingFeedback ? item.feedbackLabel : item.label}
            </span>
            {hasSubmenu && (
              <CaretRight
                size={10}
                weight="regular"
                color="var(--text-dim)"
                style={{ flexShrink: 0 }}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
      {submenuIndex !== null && (() => {
        const parentEntry = menu.entries[submenuIndex];
        if (parentEntry.type === "separator" || !parentEntry.submenu) return null;
        const parentTop = topOffsets[submenuIndex] ?? 4;
        return (
          <div
            ref={submenuRef}
            role="menu"
            style={{
              position: "absolute",
              left: submenuFlipped ? undefined : "100%",
              right: submenuFlipped ? "100%" : undefined,
              marginLeft: submenuFlipped ? 1 : -1,
              top: parentTop,
              zIndex: 1001,
              minWidth: 160,
              maxWidth: 240,
              padding: 4,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.16)",
            }}
          >
            {parentEntry.submenu.map((subItem, subIndex) => {
              const subDisabled = subItem.disabled ?? false;
              const subActive = submenuActiveIndex === subIndex;
              return (
                <div
                  key={subIndex}
                  role="menuitem"
                  aria-disabled={subDisabled || undefined}
                  onClick={() => selectSubmenuItem(subItem)}
                  onMouseEnter={() => { if (!subDisabled) setSubmenuActiveIndex(subIndex); }}
                  onMouseLeave={() => { if (submenuActiveIndex === subIndex) setSubmenuActiveIndex(-1); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    height: 28,
                    padding: "0 8px",
                    borderRadius: 5,
                    cursor: subDisabled ? "default" : "pointer",
                    background: subActive ? "var(--bg-hover)" : "transparent",
                    color: subDisabled ? "var(--text-dim)" : subItem.danger ? "#ef4444" : "var(--text)",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    opacity: subDisabled ? 0.55 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: subDisabled ? "inherit" : subItem.danger ? "#ef4444" : "var(--text-dim)",
                    }}
                  >
                    {subItem.checked ? (
                      <Check size={13} weight="bold" color="var(--accent)" aria-hidden="true" />
                    ) : (
                      subItem.icon
                    )}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {subItem.label}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  ) : null;

  return (
    <ContextMenuContext.Provider value={api}>
      {children}
      {typeof document !== "undefined" ? createPortal(menuBody, document.body) : null}
    </ContextMenuContext.Provider>
  );
}
