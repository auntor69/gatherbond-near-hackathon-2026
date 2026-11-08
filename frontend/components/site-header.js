import Link from "next/link";

import { ArrowUpRight, Menu } from "./icons";

const NAV_ITEMS = [
  { href: "/#discover", label: "Discover" },
  { href: "/#how", label: "How it works" },
  { href: "/studio", label: "Organizer studio" },
  { href: "/commitments", label: "My commitments" },
];

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="brand" aria-label="GatherBond home">
          <span className="brand-mark">GB</span>
          <span className="brand-word">GatherBond</span>
        </Link>

        <nav className="desktop-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <span className="network-pill">
            <span className="network-dot" aria-hidden="true" />
            NEAR Testnet
          </span>
          <Link href="/studio" className="header-cta">
            Host an event
            <ArrowUpRight size={15} />
          </Link>
        </div>

        <details className="mobile-nav">
          <summary aria-label="Open navigation menu">
            <Menu />
          </summary>
          <div className="mobile-nav-panel">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="mobile-nav-link">
                {item.label}
                <ArrowUpRight size={16} />
              </Link>
            ))}
            <div className="mobile-nav-meta">
              <span className="network-dot" aria-hidden="true" />
              NEAR Testnet · prototype
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
