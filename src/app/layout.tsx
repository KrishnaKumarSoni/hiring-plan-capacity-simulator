import type { Metadata } from "next";
import { Schibsted_Grotesk, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

const sans = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Hiring Plan Capacity Simulator",
  description:
    "Can your hiring plan fit your interviewer capacity? Deterministic weekly max-flow feasibility, backlog and slip — from a 3-line plan description.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
