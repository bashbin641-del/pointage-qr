import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pointage | INOX PRÉSENCE",
  description: "Borne de pointage INOX PRÉSENCE",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
