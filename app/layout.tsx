import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pisač",
  description: "Pisač — akademski uređivač s provenijencijom teksta.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="hr">
      <body>{children}</body>
    </html>
  );
}
