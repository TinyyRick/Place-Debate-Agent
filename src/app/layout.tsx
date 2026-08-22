import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Place Debate Agent",
  description: "Three places debate their fit for your preference.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
