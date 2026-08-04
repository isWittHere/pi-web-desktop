import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { ContextMenuProvider } from "@/components/ContextMenu";

export default function Home() {
  return (
    <I18nProvider>
      <ContextMenuProvider>
        <Suspense>
          <AppShell />
        </Suspense>
      </ContextMenuProvider>
    </I18nProvider>
  );
}
