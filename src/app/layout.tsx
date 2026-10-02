import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import ThemeProvider from "@/components/layout/ThemeProvider";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WildfireWatch — Mapa global de incêndios em quase tempo real",
  description:
    "Mapa não oficial das anomalias térmicas detetadas pelos satélites NASA FIRMS nas últimas 72 horas, com potência radiativa, áreas estimadas e meteorologia de modelo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-PT"
      suppressHydrationWarning
      className={`${geistSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="h-dvh overflow-hidden">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "globalThis.__name ||= ((target, value) => Object.defineProperty(target, 'name', { value, configurable: true }));",
          }}
        />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <LocaleProvider>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
