import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers/session-provider";
import { PluginInitializer, PluginUpgradeNotifier, MigrationWarningNotifier } from "@/components/startup";
import { PepperVaultGate } from "@/components/startup/pepper-vault-gate";
import { AppLayout } from "@/components/layout/app-layout";

export const metadata: Metadata = {
  title: "Quilltap - AI Chat Platform",
  description: "AI-powered roleplay chat with multiple LLM providers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className="font-sans" suppressHydrationWarning>
        <PepperVaultGate />
        <Providers>
          <PluginInitializer />
          <PluginUpgradeNotifier />
          <MigrationWarningNotifier />
          <AppLayout>
            {children}
          </AppLayout>
        </Providers>
      </body>
    </html>
  );
}

