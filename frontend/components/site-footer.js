import Link from "next/link";

import { ArrowUpRight, ShieldCheck } from "./icons";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href="/" className="brand footer-logo" aria-label="GatherBond home">
              <span className="brand-mark">GB</span>
              <span className="brand-word">GatherBond</span>
            </Link>
            <p className="footer-tagline">Commit to gather.<br />Earn by showing up.</p>
            <span className="footer-network">
              <span className="network-dot" aria-hidden="true" />
              Built for NEAR Hackathon 2026
            </span>
          </div>

          <div className="footer-column">
            <h3>Product</h3>
            <Link href="/#discover">Discover</Link>
            <Link href="/#how">How the bond works</Link>
            <Link href="/studio">Organizer studio</Link>
            <Link href="/commitments">My commitments</Link>
          </div>

          <div className="footer-column">
            <h3>Build</h3>
            <a href="https://github.com/auntor69/gatherbond-near-hackathon-2026" target="_blank" rel="noreferrer">
              GitHub <ArrowUpRight size={13} />
            </a>
            <a href="/api/events" target="_blank" rel="noreferrer">
              Public events API <ArrowUpRight size={13} />
            </a>
            <a href="https://near.org" target="_blank" rel="noreferrer">
              NEAR Protocol <ArrowUpRight size={13} />
            </a>
          </div>

          <div className="footer-column footer-truth">
            <h3>Where the truth lives</h3>
            <p>
              Deposits, capacity, attendance and settlement live on the NEAR contract.
              Turso only stores display metadata and its verified hash.
            </p>
            <span className="footer-proof">
              <ShieldCheck size={16} />
              Metadata is checked, never trusted.
            </span>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© 2026 GatherBond</span>
          <span>Prototype · unaudited · testnet only</span>
        </div>
      </div>
    </footer>
  );
}
