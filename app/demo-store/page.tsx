import type { Metadata } from "next";
import DemoStorefront from "./DemoStorefront";

export const metadata: Metadata = {
  title: "Morrow Studio — Invoq checkout demo",
  description: "Temporary storefront showing a customer subscription powered by Invoq.",
};

export default function DemoStorePage() {
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_INVOQ_API_URL ??
    process.env.INVOQ_API_URL ??
    "http://localhost:3001";

  return <DemoStorefront defaultApiBaseUrl={apiBaseUrl} />;
}
