import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Finance App",
  description: "Personal Finance Tracker",
  // No `icons` block: this listed /building-columns-solid.png first, which has
  // never existed in public/, so every page load 404'd before falling back.
  // src/app/favicon.ico is picked up by Next's file convention on its own.
};

/**
 * Next injects a default viewport tag, but without `viewport-fit=cover` every
 * `env(safe-area-inset-*)` resolves to 0 on iOS — which the fixed bottom tab
 * bar relies on to clear the home indicator.
 *
 * Deliberately no `maximumScale`/`userScalable`: pinch-zoom stays available.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8fafc", // slate-50, the background every page uses
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
