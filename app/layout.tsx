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
            __html: `(function(){try{var h=document.documentElement,m=localStorage.getItem("pi-theme-mode")||"dark",t=localStorage.getItem("pi-theme")||"",q=localStorage.getItem("pi-locale"),g=localStorage.getItem("pi-language"),l=q||g,r=m;if(!q&&g){localStorage.setItem("pi-locale",g);localStorage.removeItem("pi-language")}if(!l){var n=(navigator.languages&&navigator.languages[0])||navigator.language||"";if(/^zh(?:-|$)/i.test(n))l="zh-CN"}if(!t){var od=localStorage.getItem("pi-theme-dark"),ol=localStorage.getItem("pi-theme-light");if(od){t=od.replace(/-dark$/i,"");try{localStorage.setItem("pi-theme",t);localStorage.removeItem("pi-theme-dark");localStorage.removeItem("pi-theme-light")}catch(e){}}else if(ol){t=ol.replace(/-light$/i,"");try{localStorage.setItem("pi-theme",t);localStorage.removeItem("pi-theme-dark");localStorage.removeItem("pi-theme-light")}catch(e){}}}if(m==="system"){r=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}if(r==="dark")h.classList.add("dark");if(t){h.dataset.theme=t}h.dataset.themeMode=m;h.dataset.themeResolvedMode=r;if(l==="zh-CN"){h.lang=l;h.dataset.language=l}else{h.lang="en";h.dataset.language="en"}}catch(e){var n=(navigator.languages&&navigator.languages[0])||navigator.language||"";h.lang=/^zh(?:-|$)/i.test(n)?"zh-CN":"en";h.dataset.language=h.lang}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {/*
          Static full-screen splash rendered in the initial HTML so the user
          sees the Pi logo immediately while the JS bundle loads and React
          hydrates (the server may have just started). AppShell removes this
          once the first frame is painted. It also blocks interaction with the
          not-yet-ready UI.
        */}
        <div id="pi-splash" style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "#1a1a1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26 }}>
          <svg viewBox="0 0 24 24" fill="#ffffff" fillRule="evenodd" width={88} height={88} xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ animation: "pi-splash-breathe 1.7s ease-in-out infinite" }}>
            <path clipRule="evenodd" d="M1 1h16.5v11H12v5.5H6.5V23H1V1zm5.5 5.5V12H12V6.5H6.5z" />
            <path d="M17.5 12H23v11h-5.5V12z" />
          </svg>
        </div>
        {children}
      </body>
    </html>
  );
}
