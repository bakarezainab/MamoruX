import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MamoruX — Confidential AI Dark-Pool & Policy Firewall on NEAR",
  description:
    "Institutional Private Intent Solver & Multi-Agent Security Firewall powered by NEAR AI Cloud TEEs, NEAR Intents, and MPC Chain Signatures.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-[#0A0A0A] text-white selection:bg-[#00EC97] selection:text-black">
        {children}
      </body>
    </html>
  );
}
