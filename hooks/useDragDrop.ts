"use client";

import { useState, useCallback, useRef } from "react";

/** True when the payload contains at least one readable file (not only
 *  directories). Directory-only drags are ignored — dropping a folder has no
 *  well-defined "reference" meaning yet. */
function hasDroppableFiles(items: DataTransferItemList | null): boolean {
  if (!items) return false;
  let hasFile = false;
  let hasNonDirectory = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || item.kind !== "file") continue;
    hasFile = true;
    const entry = item.webkitGetAsEntry?.();
    if (!entry || !entry.isDirectory) hasNonDirectory = true;
  }
  return hasFile && hasNonDirectory;
}

function containsImages(items: DataTransferItemList | null): boolean {
  if (!items) return false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && item.kind === "file" && item.type.startsWith("image/")) return true;
  }
  return false;
}

/** Filters directory entries out of a drop payload (their File objects carry
 *  no readable content). Chromium exposes them via webkitGetAsEntry; when the
 *  entries are unavailable (some Electron builds) every payload item is kept. */
function filePayloadWithoutDirectories(e: React.DragEvent): File[] {
  const files = Array.from(e.dataTransfer.files);
  const entries = Array.from(e.dataTransfer.items).map((item) => item.webkitGetAsEntry?.());
  const anyEntryKnown = entries.some((entry) => entry !== null);
  if (!anyEntryKnown) return files;
  return files.filter((_, index) => entries[index]?.isDirectory !== true);
}

export function useDragDrop(onDrop: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [hasImages, setHasImages] = useState(false);
  const counterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasDroppableFiles(e.dataTransfer.items)) return;
    e.preventDefault();
    counterRef.current += 1;
    setHasImages(containsImages(e.dataTransfer.items));
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasDroppableFiles(e.dataTransfer.items)) return;
    e.preventDefault();
    setHasImages(containsImages(e.dataTransfer.items));
  }, []);

  const handleDragLeave = useCallback(() => {
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current = 0;
    setIsDragOver(false);
    const files = filePayloadWithoutDirectories(e);
    if (files.length) onDrop(files);
  }, [onDrop]);

  return { isDragOver, hasImages, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
