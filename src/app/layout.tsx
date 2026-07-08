import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dance Skeleton — Proof of Concept",
  description: "Upload a dance video, see a faceless skeleton figure",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
