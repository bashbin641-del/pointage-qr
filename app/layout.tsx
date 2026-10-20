import type { Metadata } from "next";
import AppRuntimeGuard from "@/components/app-runtime-guard";
import { chunkRecoveryScript } from "@/lib/chunk-recovery";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pointage | INOX PRÉSENCE",
  description: "Borne de pointage INOX PRÉSENCE",
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <head><script dangerouslySetInnerHTML={{ __html: chunkRecoveryScript }} /></head>
      <body><AppRuntimeGuard />{children}</body>
    </html>
  );
}
