import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "決策迭代器",
  description: "商業・職涯決策的沉穩軍師",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="min-h-full flex flex-col antialiased">{children}</body>
    </html>
  );
}
