import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionProvider } from "@/components/layout/session-provider";
import { AmbientBackground } from "@/components/ambient/ambient-background";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AmbientBackground />
        <SessionProvider>
          {children}
        </SessionProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
