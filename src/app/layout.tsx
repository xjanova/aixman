import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Noto_Sans_Thai, Unbounded } from "next/font/google";
import { SessionProvider } from "@/components/layout/session-provider";
import { ToastProvider } from "@/components/ui/toast-provider";
import { AmbientBackground } from "@/components/ambient/ambient-background";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

// X-DREAMER typography — must match the reference template's font stack
// (`'Noto Sans Thai', 'Inter', system-ui, sans-serif`). Without these
// next/font imports, browsers fall back to Geist Fallback for Thai text,
// which renders much heavier than the design intends.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600", "700", "900"],
  display: "swap",
});

const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-sans-thai",
  subsets: ["thai"],
  weight: ["200", "300", "400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The X-DREAMER wordmark beside the mark in every nav (components/xdreamer/logo).
const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#3B82F6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const en = (await getLocale()) === "en";
  // No vendor names: customers are never told which services we run on.
  const description = en
    ? "Create AI images, videos, music and speech in one studio — pay per piece with credits."
    : "สร้างภาพ วิดีโอ เพลง และเสียงพูดด้วย AI ในสตูดิโอเดียว จ่ายเป็นเครดิตตามที่ใช้จริง";
  return {
    title: {
      default: en ? "XMAN AI Studio — AI Image & Video Generation" : "XMAN AI Studio — สร้างภาพและวิดีโอด้วย AI",
      template: "%s | XMAN AI Studio",
    },
    description,
    keywords: ["AI", "image generation", "video generation", "AI art", "AI music", "text to speech", "สร้างภาพ AI", "สร้างวิดีโอ AI"],
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "XMAN AI",
    },
    icons: {
      icon: "/favicon.png",
      apple: "/apple-touch-icon.png",
    },
    openGraph: {
      title: "XMAN AI Studio",
      description,
      type: "website",
      locale: en ? "en_GB" : "th_TH",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The visitor's language (cookie, else Accept-Language, else Thai). Reading
  // it makes every page render per request, which they mostly did already.
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${inter.variable} ${notoSansThai.variable} ${geistMono.variable} ${unbounded.variable} h-full antialiased dark`}
    >
      {/* Body has no opaque bg — AmbientBackground (fixed, z-index 0) supplies the dark base + fiber threads. Adding `bg-background` here would cover them entirely. */}
      <body className="min-h-full flex flex-col text-foreground">
        <AmbientBackground />
        {/* Load-bearing, not cosmetic: AmbientBackground is `fixed z-0` over an
            opaque base, and CSS paints z-index 0 layers after ordinary content.
            Without a positioned layer above it, every page's unpositioned text
            and panels are laid out but covered — only elements that happen to
            be `position: relative` show through. One layer here covers every
            route, instead of each layout remembering (admin's used to). */}
        <div className="relative z-[1] flex flex-1 flex-col">
          <LocaleProvider locale={locale}>
            <SessionProvider>
              <ToastProvider>
                {children}
              </ToastProvider>
            </SessionProvider>
          </LocaleProvider>
        </div>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
