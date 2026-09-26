import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gemma-1B — Confidential Inference",
  description: "Conformal Confidential Inference demo: Gemma-1B on vLLM inside an Azure Confidential VM (AMD SEV-SNP).",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the sidebar's collapsed state server-side so the very first paint
  // already has the right width — avoids a flash-of-wrong-state that would
  // happen if this were only known after client-side hydration.
  const cookieStore = await cookies();
  const sidebarState = cookieStore.get("sidebar_state")?.value;

  return (
    <html lang="en" data-sidebar-collapsed={sidebarState === "collapsed"}>
      <body>{children}</body>
    </html>
  );
}
