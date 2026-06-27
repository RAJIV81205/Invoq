import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Invoq — Programmable Subscription Billing for Stellar",
  description:
    "Stripe Billing, but fully on-chain and programmable on Stellar. Managed recurring billing, usage metering, and prepaid escrow for AI APIs and SaaS.",
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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        {children}
      </body>
    </html>
  );
}
