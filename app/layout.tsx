import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import "@fontsource/ia-writer-quattro";
import "@fontsource/ia-writer-quattro/400-italic.css";
import "@fontsource/ia-writer-quattro/700.css";
import "@fontsource/ia-writer-quattro/700-italic.css";
import "@fontsource/lilex";

export const metadata: Metadata = {
  title: "Pi Agent Web",
  description: "Pi Coding Agent Web Interface",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-language="en" translate="no" className="notranslate" suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var h=document.documentElement,m=localStorage.getItem("pi-theme-mode")||"dark",t=localStorage.getItem("pi-theme")||"",l=localStorage.getItem("pi-language"),r=m;if(!t){var od=localStorage.getItem("pi-theme-dark"),ol=localStorage.getItem("pi-theme-light");if(od){t=od.replace(/-dark$/i,"");try{localStorage.setItem("pi-theme",t);localStorage.removeItem("pi-theme-dark");localStorage.removeItem("pi-theme-light")}catch(e){}}else if(ol){t=ol.replace(/-light$/i,"");try{localStorage.setItem("pi-theme",t);localStorage.removeItem("pi-theme-dark");localStorage.removeItem("pi-theme-light")}catch(e){}}}if(m==="system"){r=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}if(r==="dark")h.classList.add("dark");if(t){h.dataset.theme=t}h.dataset.themeMode=m;h.dataset.themeResolvedMode=r;if(l==="zh-CN"){h.lang=l;h.dataset.language=l}else{h.dataset.language="en"}}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
