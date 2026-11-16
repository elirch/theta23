import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://theta23.com"),
  title: "Theta23 — Space Mission Readiness Radar",
  description:
    "See which components and dependencies around the world threaten a space mission's next milestone, and how much schedule margin remains. Illustrative demo data.",
  openGraph: {
    title: "Theta23 — Space Mission Readiness Radar",
    description: "A disruption on Earth becomes an understandable consequence for a space mission.",
    url: "https://theta23.com",
    siteName: "Theta23",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#060a13",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
