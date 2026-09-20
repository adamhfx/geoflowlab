import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GeoFlow Lab",
  description: "Scientific economics workbench",
  icons: {
    icon: [{ url: "/geoflow-lab-icon.svg", type: "image/svg+xml" }],
    shortcut: "/geoflow-lab-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
