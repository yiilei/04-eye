import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "04的眼",
  description: "04的眼视觉素材本地批阅。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
