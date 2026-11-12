import { GitHubMark, Mail, XBrand } from "./icons";

const SOCIAL = [
  {
    href: "https://x.com/GatherBondApp",
    label: "GatherBond on X",
    Icon: XBrand,
  },
  {
    href: "mailto:gatherbond.app@gmail.com",
    label: "Email GatherBond",
    Icon: Mail,
  },
  {
    href: "https://github.com/auntor69/gatherbond-near-hackathon-2026",
    label: "GatherBond on GitHub",
    Icon: GitHubMark,
  },
];

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-bar">
        <span className="footer-copy">© 2026 · Testnet</span>

        <div className="footer-links">
          {SOCIAL.map(({ href, label, Icon }) => (
            <a
              key={label}
              href={href}
              aria-label={label}
              title={label}
              {...(href.startsWith("http")
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
            >
              <Icon size={16} />
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
