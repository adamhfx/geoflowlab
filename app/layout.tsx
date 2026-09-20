import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GeoFlow Lab",
  description:
    "Explore project economics with GeoFlow Lab. Compare subscription plans for private saved scenarios, calculation history, and editable Excel results.",
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
