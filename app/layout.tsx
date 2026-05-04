import type { Metadata } from "next";
import { Geist_Mono, Hedvig_Letters_Serif, Bitter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AppShell } from "@/components/layout/AppShell";
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
  title: "Guardian Dashboard",
  description: "Monitor your OpenZeppelin Guardian node",
  icons: { icon: "/orangerobot.png" },
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
          <AppShell>{children}</AppShell>
        </ClerkProvider>
      </body>
    </html>
  );
}
