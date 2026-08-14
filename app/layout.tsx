import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./wallpaper.css";
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
            __html: `(function(){try{var h=document.documentElement,m=localStorage.getItem("pi-theme-mode")||"dark",t=localStorage.getItem("pi-theme")||"",q=localStorage.getItem("pi-locale"),g=localStorage.getItem("pi-language"),l=q||g,r=m;if(!q&&g){localStorage.setItem("pi-locale",g);localStorage.removeItem("pi-language")}if(!l){var n=(navigator.languages&&navigator.languages[0])||navigator.language||"";if(/^zh(?:-|$)/i.test(n))l="zh-CN"}if(!t){var od=localStorage.getItem("pi-theme-dark"),ol=localStorage.getItem("pi-theme-light");if(od){t=od.replace(/-dark$/i,"");try{localStorage.setItem("pi-theme",t);localStorage.removeItem("pi-theme-dark");localStorage.removeItem("pi-theme-light")}catch(e){}}else if(ol){t=ol.replace(/-light$/i,"");try{localStorage.setItem("pi-theme",t);localStorage.removeItem("pi-theme-dark");localStorage.removeItem("pi-theme-light")}catch(e){}}}var fs=parseFloat(localStorage.getItem("pi-font-scale"));if(!isNaN(fs)&&fs>=0.8&&fs<=1.5){h.style.setProperty("--app-ui-scale",String(Math.round(fs*100)/100))}if(m==="system"){r=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}if(r==="dark")h.classList.add("dark");if(t){h.dataset.theme=t}h.dataset.themeMode=m;h.dataset.themeResolvedMode=r;var wpe=localStorage.getItem("pi-wallpaper-enabled"),wps=localStorage.getItem("pi-wallpaper-scrim");if(wpe!=="0"){var sc=parseFloat(wps);if(isNaN(sc)){sc=70}else{sc=Math.min(95,Math.max(30,Math.round(sc)))}h.dataset.wallpaper="on";h.style.setProperty("--wallpaper-scrim",sc+"%");var wI=localStorage.getItem("pi-wallpaper-input"),wM=localStorage.getItem("pi-wallpaper-message"),wP=localStorage.getItem("pi-wallpaper-panel");h.dataset.wallpaperInput=(wI==="none"||wI==="trans"||wI==="blur")?wI:"blur";h.dataset.wallpaperMessage=(wM==="none"||wM==="trans"||wM==="blur")?wM:"none";h.dataset.wallpaperPanel=(wP==="none"||wP==="trans"||wP==="blur")?wP:"none"}if(l==="zh-CN"){h.lang=l;h.dataset.language=l}else{h.lang="en";h.dataset.language="en"}}catch(e){var n=(navigator.languages&&navigator.languages[0])||navigator.language||"";h.lang=/^zh(?:-|$)/i.test(n)?"zh-CN":"en";h.dataset.language=h.lang}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning style={{ height: "calc(100dvh / var(--app-ui-scale, 1))", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
