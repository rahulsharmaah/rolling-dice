import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spindle Dice – Next.js + Three",
  description: "Pen-like 4-sided dice with thoughts after 4 rolls",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen"suppressHydrationWarning>{children}</body>
    </html>
  );
}
