import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sonny Agent - Tu agente de desarrollo autónomo",
  description: "Agente de desarrollo que usa IAs externas como cerebro para ejecutar tareas de programación automáticamente.",
  keywords: ["Sonny", "Agent", "AI", "Development", "Automation", "Playwright", "Next.js"],
  authors: [{ name: "Sonny Team" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Sonny Agent",
    description: "Agente de desarrollo autónomo con IA externa como cerebro",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
