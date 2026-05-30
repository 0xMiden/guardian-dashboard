import type { Metadata } from "next";
import { Geist_Mono, Hedvig_Letters_Serif, Bitter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AppShell } from "@/components/layout/AppShell";
import { PostHogPageView } from "@/components/analytics/PostHogPageView";
import { Suspense } from "react";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const hedvig = Hedvig_Letters_Serif({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: "400",
});

const bitter = Bitter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Miden Guardian Dashboard",
  description: "Monitor your Guardian service running on Miden",
  icons: { icon: "/orangerobot.png" },
  openGraph: {
    title: "Miden Guardian Dashboard",
    description: "Monitor your Guardian service running on Miden",
    siteName: "Miden Guardian Dashboard",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Miden Guardian Dashboard",
    description: "Monitor your Guardian service running on Miden",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistMono.variable} ${hedvig.variable} ${bitter.variable} h-full antialiased dark`}>
      <body className="h-full">
        <ClerkProvider>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          <AppShell>{children}</AppShell>
        </ClerkProvider>
      </body>
    </html>
  );
}
