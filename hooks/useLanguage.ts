"use client";

import { useCallback } from "react";
import { enLocale } from "@/lib/i18n/messages/en";
import type { TranslationParams } from "@/lib/i18n/types";
import { useI18n } from "@/hooks/useI18n";

export type Language = "en" | "zh-CN";
export type TranslationKey = keyof typeof enLocale.messages;

/**
 * Backward-compatible flat-key interface for desktop components.
 * New code may use useI18n directly while existing screens migrate gradually.
 */
export function useLanguage() {
  const { locale, setLocale, t: translate } = useI18n();

  const setLanguage = useCallback((next: Language) => {
    setLocale(next);
  }, [setLocale]);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(key, params),
    [translate],
  );

  return { language: locale, setLanguage, t };
}
