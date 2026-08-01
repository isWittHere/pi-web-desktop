"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { translateMessage } from "@/lib/i18n/format";
import { getLocalePlugin, getSupportedLocales, isSupportedLocale, resolveBrowserLocale } from "@/lib/i18n/registry";
import type { Locale, LocalePlugin, TranslationParams } from "@/lib/i18n/types";

const LOCALE_STORAGE_KEY = "pi-locale";
const defaultLocale: Locale = "en";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
  supportedLocales: LocalePlugin[];
}

export const I18nContext = createContext<I18nContextValue | null>(null);

function getMessages(): Record<Locale, Record<string, string>> {
  const en = getLocalePlugin("en");
  const zhCN = getLocalePlugin("zh-CN");
  if (!en || !zhCN) throw new Error("Built-in locales must be registered before rendering I18nProvider");
  return { en: en.messages, "zh-CN": zhCN.messages };
}

function readInitialLocale(): Locale {
  try {
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(storedLocale)) return storedLocale;
  } catch {
    // Storage can be unavailable in private browsing or restricted desktop contexts.
  }
  return resolveBrowserLocale(window.navigator.languages.length ? window.navigator.languages : [window.navigator.language]);
}

function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dataset.language = locale;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Persisting a preference is optional; the active page still updates.
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const next = readInitialLocale();
    setLocaleState(next);
    document.documentElement.lang = next;
    setHydrated(true);
  }, []);

  const messages = useMemo(() => getMessages(), []);
  const supportedLocales = useMemo(
    () => getSupportedLocales().map((id) => getLocalePlugin(id)).filter((p): p is LocalePlugin => Boolean(p)),
    [],
  );
  const setLocale = useCallback((next: Locale) => {
    if (!getLocalePlugin(next)) return;
    setLocaleState(next);
    applyLocale(next);
  }, []);
  const t = useCallback(
    (key: string, params?: TranslationParams) => translateMessage(locale, key, messages, params),
    [locale, messages],
  );
  const value = useMemo(() => ({ locale, setLocale, t, supportedLocales }), [locale, setLocale, t, supportedLocales]);

  // The server cannot read localStorage. Delay language-dependent UI until the
  // client has resolved the persisted locale so SSR and hydration never compare
  // different language trees.
  return <I18nContext.Provider value={value}>{hydrated ? children : null}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
