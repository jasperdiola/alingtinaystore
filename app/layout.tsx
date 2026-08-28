import type { Metadata } from "next";
import { DM_Sans, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The storefront face. Declared here because next/font must be initialised at
 * module scope in a layout, but only the (store) group actually applies it —
 * the admin stays on Geist. Both are self-hosted and preloaded by next/font, so
 * neither costs a render-blocking request to Google.
 */
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Aling Tinay's — Premium Filipino Peanuts & Snacks",
    template: "%s · Aling Tinay's",
  },
  description:
    "Premium-quality peanuts roasted to perfection. Fresh, flavorful, and made with love — from three branches across Rizal since 1980.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${dmSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
