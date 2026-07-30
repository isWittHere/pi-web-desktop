import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";

export default function Home() {
  return (
    <I18nProvider>
      <Suspense>
        <AppShell />
      </Suspense>
    </I18nProvider>
  );
}
