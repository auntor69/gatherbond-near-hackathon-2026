import Link from "next/link";

import { ArrowUpRight } from "./icons";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell">
        <div className="footer-main">
          <div className="footer-brand">
            <Link href="/" className="brand footer-logo" aria-label="GatherBond home">
              <span className="brand-mark">GB</span>
              <span className="brand-word">GatherBond</span>
            </Link>
            <p className="footer-tagline">Refundable commitments for rooms that deserve a full table.</p>
          </div>

          <nav className="footer-nav" aria-label="Footer navigation">
            <span>Explore</span>
            <Link href="/#discover">Discover rooms</Link>
            <Link href="/#how">How the bond works</Link>
            <Link href="/studio">Organizer studio</Link>
            <Link href="/commitments">My commitments</Link>
          </nav>

          <div className="footer-meta">
            <span>Network</span>
            <span>NEAR Testnet · 2026</span>
            <span>Metadata checked. Contract decides.</span>
            <a
              href="https://github.com/auntor69/gatherbond-near-hackathon-2026"
              target="_blank"
              rel="noreferrer"
            >
              GitHub <ArrowUpRight size={12} />
            </a>
            <a href="/api/events" target="_blank" rel="noreferrer">
              Public events API <ArrowUpRight size={12} />
            </a>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© 2026 GatherBond</span>
          <span>Prototype · unaudited · testnet only</span>
          <Link href="/#discover">
            Find a room <ArrowUpRight size={11} />
          </Link>
        </div>
      </div>
    </footer>
  );
}
