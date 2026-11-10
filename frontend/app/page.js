import Link from "next/link";

import Discover from "../components/discover";
import { ArrowRight, Check, ShieldCheck, Ticket } from "../components/icons";

const TICKER = [
  "DEPOSIT",
  "SHOW UP",
  "GET IT BACK",
  "SHARE THE NO-SHOW POOL",
  "ONE-TIME CHECK-IN",
  "ON-CHAIN ATTENDANCE",
];

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="shell hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">NEAR Testnet / event commitments</p>
            <h1>
              Make plans
              <br />
              that <em>actually</em>
              <br />
              happen.
            </h1>
            <p className="hero-lede">
              GatherBond turns a yes into a refundable deposit on NEAR. Show up, get it back,
              and share the pool left by the people who did not. No-shows fund the room.
            </p>
            <div className="hero-actions">
              <Link href="#discover" className="button button-dark">
                Find an event
                <ArrowRight size={17} />
              </Link>
              <Link href="/studio" className="button button-ghost">
                Host something
              </Link>
            </div>
            <ul className="hero-proof">
              <li>
                <Check size={14} />
                Refundable deposits
              </li>
              <li>
                <Ticket size={14} />
                One-time check-in
              </li>
              <li>
                <ShieldCheck size={14} />
                Auditable settlement
              </li>
            </ul>
            <p className="hero-disclaimer">Testnet prototype · no real funds</p>
          </div>

          <div className="poster-stage">
            <span className="poster-orbit" aria-hidden="true" />
            <span className="poster-orbit poster-orbit--inner" aria-hidden="true" />

            <article className="poster-card" aria-label="GatherBond protocol poster">
              <div className="poster-card-top">
                <span>GATHERBOND / PROTOCOL</span>
                <span>TESTNET</span>
              </div>
              <div className="poster-art">
                <span className="poster-art-kicker">One room, one agreement</span>
                <span className="poster-art-number">01</span>
                <span className="poster-art-ring poster-art-ring--one" aria-hidden="true" />
                <span className="poster-art-ring poster-art-ring--two" aria-hidden="true" />
                <span className="poster-art-bottom">
                  DEPOSIT
                  <br />
                  SHOW UP · SETTLE
                </span>
              </div>
              <div className="poster-card-bottom">
                <div>
                  <strong>Escrow, not promises</strong>
                  <span>NEAR Testnet contract</span>
                </div>
                <div className="poster-stub">
                  REAL
                  <br />
                  ON-CHAIN
                </div>
              </div>
            </article>

            <span className="poster-sticker" aria-hidden="true">
              SHOW
              <br />
              UP.
            </span>
            <span className="poster-note">Every listing is a verified contract event</span>
          </div>
        </div>
      </section>

      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[0, 1].map((group) => (
            <div className="ticker-group" key={group}>
              {TICKER.map((item) => (
                <span key={`${group}-${item}`}>
                  {item}
                  <span className="ticker-star">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <Discover />

      <section className="section how-section" id="how">
        <div className="shell">
          <div className="section-head">
            <div>
              <p className="eyebrow">03 — The mechanic</p>
              <h2 className="section-title">
                Three moments.
                <br />
                <em>One honest agreement.</em>
              </h2>
            </div>
            <p className="section-copy">
              The contract does not ask for trust. It asks for a deposit, a check-in and a
              deadline. Everything else is a rule you can read before you commit.
            </p>
          </div>

          <div className="steps-grid">
            <article className="step">
              <span className="step-number">01</span>
              <h3>Put something on the line.</h3>
              <p>
                The organizer publishes a deposit, capacity and a schedule. You reserve with the
                exact native NEAR amount, not a card or a promise.
              </p>
              <span className="step-tail">Reserve</span>
            </article>
            <article className="step">
              <span className="step-number">02</span>
              <h3>Show up in the window.</h3>
              <p>
                Your one-time ticket is checked in by the organizer during the published window.
                Attendance is a contract fact, not a badge.
              </p>
              <span className="step-tail">Check in</span>
            </article>
            <article className="step">
              <span className="step-number">03</span>
              <h3>Take the room with you.</h3>
              <p>
                Checked-in guests claim their deposit plus a share of the no-show pool. The
                remainder goes to the configured treasury, not a black box.
              </p>
              <span className="step-tail">Settle</span>
            </article>
          </div>

          <div className="how-note">
            <span className="how-note-mark">≠</span>
            <p>
              <strong>Refundable is a rule, not a vibe.</strong> The contract holds the deposit,
              the metadata database never does, and a failed transfer restores the claim instead
              of making it disappear.
            </p>
            <Link href="/studio#create" className="text-link">
              Create a real event
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      <section className="manifesto">
        <div className="shell">
          <div className="manifesto-grid">
            <div>
              <p className="eyebrow">Why a bond</p>
              <h2>
                Presence has a price.
                <br />
                <em>Absence pays.</em>
              </h2>
            </div>
            <div className="manifesto-copy">
              <p>
                A free RSVP costs nothing to break. That is why the room is full on paper and
                quiet in real life. GatherBond gives the yes a little weight, then gives it back
                when you do the thing you said you would.
              </p>
              <p>
                It is not a penalty. It is a shared agreement with a visible edge: the people who
                stay home fund the people who show up.
              </p>
              <Link href="/studio" className="text-link text-link--light">
                See how a room is published
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>

          <div className="flow-strip">
            <div>
              <span>01 / RESERVE</span>
              <strong>Deposit locked</strong>
              <p>Exact amount. Native NEAR. Refundable under the published rules.</p>
            </div>
            <div>
              <span>02 / ATTEND</span>
              <strong>Ticket consumed</strong>
              <p>Organizer-authorized check-in inside the event window.</p>
            </div>
            <div>
              <span>03 / CLAIM</span>
              <strong>Presence rewarded</strong>
              <p>Deposit plus a share of the no-show pool, paid by pull claim.</p>
            </div>
          </div>

          <p className="manifesto-footnote">
            NEAR Testnet only · the financial rules live in the contract · metadata is display,
            never authority
          </p>
        </div>
      </section>
    </main>
  );
}
