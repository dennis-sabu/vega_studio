import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VEGA Studio",
  description: "VEGA Studio — Desktop IDE for C-DAC VEGA ARIES V3",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#06070c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" className="dark h-full antialiased">
      <body className="flex h-full min-h-0 flex-col bg-[#06070c] text-[#e8ebf7]">
        {children}
      </body>
    </html>
  );
}
