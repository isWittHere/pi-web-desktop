"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { translateMessage } from "@/lib/i18n/format";
import { getLocalePlugin, getSupportedLocales, isSupportedLocale, resolveBrowserLocale } from "@/lib/i18n/registry";
import type { Locale, LocalePlugin, TranslationParams } from "@/lib/i18n/types";

const LEGACY_STORAGE_KEY = "pi-language";
const LOCALE_STORAGE_KEY = "pi-locale";
const defaultLocale: Locale = "en";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
  supportedLocales: LocalePlugin[];
}

const I18nContext = createContext<I18nContextValue | null>(null);
const listeners = new Set<() => void>();

function getMessages(): Record<Locale, Record<string, string>> {
  const en = getLocalePlugin("en");
  const zhCN = getLocalePlugin("zh-CN");
  if (!en || !zhCN) throw new Error("Built-in locales must be registered before rendering I18nProvider");
  return { en: en.messages, "zh-CN": zhCN.messages };
}

function getDocumentLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const value = document.documentElement.dataset.language;
  return isSupportedLocale(value) ? value : null;
}

function readInitialLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;

  const documentLocale = getDocumentLocale();
  if (documentLocale) return documentLocale;

  try {
    const legacyLocale = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (isSupportedLocale(legacyLocale)) return legacyLocale;
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(storedLocale)) return storedLocale;
  } catch {
    // Storage can be unavailable in private browsing or restricted desktop contexts.
  }

  return resolveBrowserLocale(window.navigator.languages.length ? window.navigator.languages : [window.navigator.language]);
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): Locale {
  return readInitialLocale();
}

function getServerSnapshot(): Locale {
  return defaultLocale;
}

function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dataset.language = locale;
  try {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, locale);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Persisting a preference is optional; the active page still updates.
  }
  listeners.forEach((callback) => callback());
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const supportedLocales = useMemo(
    () => getSupportedLocales().map((id) => getLocalePlugin(id)).filter((plugin): plugin is LocalePlugin => Boolean(plugin)),
    [],
  );
  const messages = useMemo(() => getMessages(), []);

  const setLocale = useCallback((next: Locale) => {
    if (!getLocalePlugin(next)) return;
    applyLocale(next);
  }, []);

  const t = useCallback(
    (key: string, params?: TranslationParams) => translateMessage(locale, key, messages, params),
    [locale, messages],
  );
  const value = useMemo(() => ({ locale, setLocale, t, supportedLocales }), [locale, setLocale, t, supportedLocales]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
