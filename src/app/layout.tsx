import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Noto_Sans_Thai } from "next/font/google";
import { SessionProvider } from "@/components/layout/session-provider";
import { ToastProvider } from "@/components/ui/toast-provider";
import { AmbientBackground } from "@/components/ambient/ambient-background";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
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

export const viewport: Viewport = {
  themeColor: "#3B82F6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "XMAN AI Studio — AI Image & Video Generation",
    template: "%s | XMAN AI Studio",
  },
  description:
    "Generate stunning AI images and videos with multiple providers. Powered by BytePlus, OpenAI, Stability AI, Runway, and more.",
  keywords: [
    "AI",
    "image generation",
    "video generation",
    "AI art",
    "Stable Diffusion",
    "DALL-E",
    "Sora",
    "BytePlus",
  ],
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
    description: "AI Image & Video Generation Platform",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${inter.variable} ${notoSansThai.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AmbientBackground />
        <SessionProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </SessionProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
