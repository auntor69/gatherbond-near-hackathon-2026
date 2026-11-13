import "./globals.css";
import "./flow.css";
import "./nocturne.css";

import SiteFooter from "../components/site-footer";
import SiteHeader from "../components/site-header";
import { WalletProvider } from "../components/wallet-provider";
import { siteUrl } from "../lib/site.js";

const description =
  "Refundable commitments for real-world gatherings on NEAR. Show up, get your bond back, and share the no-show pool.";

export const metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "GatherBond — Make plans. Keep them.",
    template: "%s · GatherBond",
  },
  description,
  applicationName: "GatherBond",
  authors: [{ name: "GatherBond" }],
  creator: "GatherBond",
  publisher: "GatherBond",
  category: "events",
  classification: "Event commitment platform",
  keywords: [
    "GatherBond",
    "NEAR events",
    "event commitments",
    "refundable deposit",
    "no-show pool",
    "NEAR Testnet",
    "event check-in",
    "real-world gatherings",
  ],
  referrer: "origin-when-cross-origin",
  formatDetection: { telephone: false, address: false, email: false },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "GatherBond",
    title: "GatherBond — Make plans. Keep them.",
    description,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "GatherBond — refundable commitments for real-world gatherings on NEAR Testnet",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@GatherBondApp",
    creator: "@GatherBondApp",
    title: "GatherBond — Make plans. Keep them.",
    description,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
    shortcut: "/icon.svg",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "GatherBond",
    statusBarStyle: "default",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#f1ede4",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <WalletProvider>
          <SiteHeader />
          <div id="main-content">{children}</div>
          <SiteFooter />
        </WalletProvider>
      </body>
    </html>
  );
}
