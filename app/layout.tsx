import type { Metadata } from "next";
import { Inter, Noto_Sans_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pi Agent Web",
  description: "Pi Coding Agent Web Interface",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-language="en" translate="no" className={`${inter.variable} ${notoSansMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var h=document.documentElement,t=localStorage.getItem("pi-theme"),l=localStorage.getItem("pi-language");if(t==="dark")h.classList.add("dark");if(l==="zh-CN"){h.lang=l;h.dataset.language=l}else{h.dataset.language="en"}}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
