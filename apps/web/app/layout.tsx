import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { siteUrl } from '@/lib/seo/site';
import { PLATFORM_NAME } from '@/lib/brand';
import { PublicFeedback } from '@/features/appearance/public-feedback';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: `${PLATFORM_NAME} | One operating system for your business`,
  // Not `vision.md`'s "One engine. Many businesses." -- that's the platform's own architecture,
  // read by whoever builds it. A search result is read by the one business being sold to.
  description:
    `${PLATFORM_NAME} replaces the spreadsheet, the shared calendar and the group chat holding your business together.`,
  applicationName: PLATFORM_NAME,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <PublicFeedback />
      </body>
    </html>
  );
}
