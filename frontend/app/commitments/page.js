import Link from "next/link";

import { ArrowRight, ArrowUpRight, Check, ShieldCheck, Ticket, Wallet } from "../../components/icons";

export const metadata = {
  title: "My commitments",
  description: "Reservations, tickets and attendance will live here once wallet registration is connected.",
};

const STATES = [
  {
    label: "Reserved",
    copy: "The deposit is locked in the event contract and a one-time ticket commitment exists.",
  },
  {
    label: "Checked in",
    copy: "The organizer consumed the ticket inside the window. Attendance is on chain.",
  },
  {
    label: "Settled",
    copy: "The event is finalized and the attendee can pull their deposit plus reward share.",
  },
];

export default function CommitmentsPage() {
  return (
    <main className="page page--commitments">
      <section className="commitments-hero">
        <div className="shell commitments-hero-grid">
          <div>
            <p className="eyebrow">My commitments / attendee side</p>
            <h1>
              Plans are easy.
              <br />
              <em>Showing up is the point.</em>
            </h1>
            <p className="commitments-lede">
              Your reservations, one-time tickets and attendance history belong here. Nothing is
              shown as yours until it is read from the contract for your signed-in account.
            </p>
            <div className="hero-actions">
              <Link href="/#discover" className="button button-dark">
                Find your first room
                <ArrowRight size={16} />
              </Link>
              <span className="wallet-chip">
                <Wallet size={15} />
                Wallet not connected
              </span>
            </div>
          </div>

          <aside className="sample-ticket" aria-label="Sample ticket, not on-chain">
            <div className="sample-ticket-top">
              <span>DEMO TICKET</span>
              <span>NOT ON-CHAIN</span>
            </div>
            <div className="sample-ticket-art">
              <span>GATHERBOND</span>
              <strong>014</strong>
              <span className="sample-ticket-ring" aria-hidden="true" />
            </div>
            <div className="sample-ticket-bottom">
              <div>
                <span className="sample-kicker">SAMPLE EVENT</span>
                <strong>Studio Night 014</strong>
                <span>21 NOV · BERLIN</span>
              </div>
              <div className="sample-stub">
                <span>ADMIT</span>
                <strong>ONE</strong>
              </div>
            </div>
            <p className="sample-ticket-note">
              This is a layout sample. It is not a ticket, balance or check-in record.
            </p>
          </aside>
        </div>
      </section>

      <section className="section commitments-body">
        <div className="shell commitments-grid">
          <div className="empty-panel">
            <span className="empty-panel-icon">
              <Ticket size={28} />
            </span>
            <p className="eyebrow">The honest empty state</p>
            <h2>No commitments yet.</h2>
            <p>
              When wallet registration is connected, this view will list reservations with their
              actual contract state, deposit and claim status. Until then it stays empty rather
              than guessing.
            </p>
            <div className="empty-panel-actions">
              <Link href="/#discover" className="button button-dark">
                Browse the shelf
                <ArrowRight size={16} />
              </Link>
              <Link href="/studio" className="button button-ghost">
                Organizer studio
              </Link>
            </div>
          </div>

          <aside className="commitments-aside">
            <div className="commitments-aside-head">
              <ShieldCheck size={20} />
              <h3>No invented balances</h3>
            </div>
            <p>
              This page will not render a deposit, ticket or attendance row unless the chain
              returns it for the authenticated account.
            </p>
            <div className="commitments-rule" />
            <div className="commitments-aside-row">
              <Check size={15} />
              Contract state, not local storage
            </div>
            <div className="commitments-aside-row">
              <Check size={15} />
              Ticket secret never in a URL
            </div>
            <div className="commitments-aside-row">
              <Check size={15} />
              Claims are individual pull withdrawals
            </div>
            <a href="https://github.com/auntor69/gatherbond-near-hackathon-2026" target="_blank" rel="noreferrer" className="text-link">
              Read the build notes
              <ArrowUpRight size={14} />
            </a>
          </aside>
        </div>

        <div className="shell states-wrap">
          <div className="section-head states-head">
            <div>
              <p className="eyebrow">The three states</p>
              <h2 className="section-title">
                A ticket is a promise
                <br />
                <em>with a paper trail.</em>
              </h2>
            </div>
            <p className="section-copy">
              Every reservation moves through the same ledger. The UI will show the state the
              contract reports, including the unglamorous ones.
            </p>
          </div>

          <div className="states-grid">
            {STATES.map((state, index) => (
              <article className="state-tile" key={state.label}>
                <span className="state-tile-number">0{index + 1}</span>
                <h3>{state.label}</h3>
                <p>{state.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
