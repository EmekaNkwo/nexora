import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { themeScript } from "@/components/shell/themeScript";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Nexora IoT Cloud",
    template: "%s · Nexora IoT Cloud",
  },
  description:
    "Operations console for monitoring and managing connected device fleets — real-time telemetry, automation rules, alerting and remote commands.",
  applicationName: "Nexora IoT Cloud",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The console is a dark surface; tell the browser so form controls and the
  // mobile address bar match rather than flashing white.
  colorScheme: "dark light",
  themeColor: "#161a21",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      // The pre-paint script sets `class` and `style` on this element before
      // React hydrates, which is exactly the mismatch this suppresses. It is
      // scoped to `<html>` and does not affect any descendant.
      suppressHydrationWarning
    >
      <head>
        {/* Blocking on purpose: it must run before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full bg-background text-foreground antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
