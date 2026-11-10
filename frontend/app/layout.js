import "./globals.css";
import "./flow.css";

import SiteFooter from "../components/site-footer";
import SiteHeader from "../components/site-header";
import { WalletProvider } from "../components/wallet-provider";

export const metadata = {
  title: {
    default: "GatherBond — Commit to gather",
    template: "%s · GatherBond",
  },
  description:
    "Refundable deposits for real-world events on NEAR. Show up, get your deposit back, and share the no-show pool.",
  applicationName: "GatherBond",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f3efe6",
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
