import type { Metadata } from "next";
import { Geist, Geist_Mono, Bitter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AppShell } from "@/components/layout/AppShell";
import { THEME_INIT_SCRIPT } from "@/components/layout/ThemeToggle";
import "./globals.css";

// Body, tables and every piece of UI chrome. Geist rather than the slab serif
// this used to be: a slab's rectangular serifs are what make it slow to scan in
// a 500-row numeric table, which is most of what this product is. It is also
// Geist Mono's sibling, drawn as one family, so an account id sits next to its
// label at a matched x-height instead of borrowing an unrelated design's.
const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Account ids and money figures.
const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

// Headings only, where a slab serif does its best work and where the editorial
// character is worth having. Promoted out of the body; Hedvig Letters Serif is
// gone, so the count of loaded families is unchanged.
const bitter = Bitter({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Miden Guardian Dashboard",
  description: "Monitor your Guardian service running on Miden",
  icons: { icon: "/orangerobot.png" },
  // Next copies the title and description into the og: and twitter: tags.
  openGraph: { siteName: "Miden Guardian Dashboard", type: "website" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${bitter.variable} h-full antialiased dark`} suppressHydrationWarning>
      <head>
        {/* Runs before first paint so a light-theme user never sees the dark
            default flash. Blocking and inline is the point. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full">
        <ClerkProvider>
          <AppShell>{children}</AppShell>
        </ClerkProvider>
      </body>
    </html>
  );
}
