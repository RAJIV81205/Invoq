import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  title: "Invoq — Programmable Subscription Billing for Stellar",
  description:
    "Stripe Billing, but fully on-chain and programmable on Stellar. Managed recurring billing, usage metering, and prepaid escrow for AI APIs and SaaS.",
  metadataBase: new URL("https://invoq.rajivdubey.tech"),
  openGraph: {
    title: "Invoq — Programmable Subscription Billing for Stellar",
    description: "Stripe Billing, but fully on-chain and programmable on Stellar.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full scroll-smooth antialiased ${inter.variable} ${playfair.variable}`}>
      <body className="min-h-full flex flex-col text-[var(--foreground)]" style={{ fontFamily: "var(--font-inter), sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
