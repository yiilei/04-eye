import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "采光",
  description: "采光视觉素材本地批阅。",
  icons: { icon: "/caiguang-icon.svg", shortcut: "/caiguang-icon.svg", apple: "/caiguang-icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
