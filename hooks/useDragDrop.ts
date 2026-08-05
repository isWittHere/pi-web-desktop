"use client";

import { useState, useCallback, useRef } from "react";

/** Chromium hides dataTransfer.items during dragenter/dragover for
 *  cross-process drags (OS file manager), so the only reliable hover-phase
 *  signal is dataTransfer.types. Items are read at drop time instead. */
function hasFilesInPayload(types: DataTransfer["types"]): boolean {
  try {
    return Array.from(types).includes("Files");
  } catch {
    return false;
  }
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
  const counterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFilesInPayload(e.dataTransfer.types)) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFilesInPayload(e.dataTransfer.types)) return;
    // Without preventDefault the browser shows the drop-forbidden cursor and
    // the drop event never fires.
    e.preventDefault();
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

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
