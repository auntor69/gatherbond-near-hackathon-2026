import Link from "next/link";

import Discover from "../components/discover";
import JsonLd from "../components/json-ld";
import { ArrowRight, ArrowUpRight, Check, ShieldCheck, Ticket } from "../components/icons";
import { homeGraph } from "../lib/seo.js";
import { loadPublishedListings } from "../lib/serverEvents.mjs";

const TICKER = [
  "MAKE PLANS",
  "KEEP THEM",
  "REFUNDABLE BONDS",
  "REAL ROOMS",
  "NEAR TESTNET",
];

export const revalidate = 60;

export const metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const listings = await loadPublishedListings(24);
  return (
    <>
      <JsonLd data={homeGraph(listings?.events ?? [])} />
      <main>
      <section className="hero">
        <div className="shell hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">NEAR Testnet / Event commitments</p>
            <h1>
              Make plans.
              <br />
              <em>Keep them.</em>
            </h1>
            <p className="hero-lede">
              A refundable bond for real-world gatherings. Reserve with NEAR, show up, and get
              it back. No-shows fund the room.
            </p>
            <div className="hero-actions">
              <Link href="#discover" className="button button-dark">
                Find an event
                <ArrowRight size={16} />
              </Link>
              <Link href="/studio" className="button button-ghost">
                Host something
              </Link>
            </div>
            <ul className="hero-proof">
              <li>
                <Check size={13} />
                Refundable deposits
              </li>
              <li>
                <Ticket size={13} />
                One-time check-in
              </li>
              <li>
                <ShieldCheck size={13} />
                Auditable settlement
              </li>
            </ul>
            <p className="hero-disclaimer">Testnet prototype · no real funds</p>
          </div>

          <div className="hero-stage">
            <span className="pass-orbit" aria-hidden="true" />
            <span className="pass-orbit pass-orbit--inner" aria-hidden="true" />

            <article className="pass-card" aria-label="GatherBond commitment pass">
              <div className="pass-card-top">
                <span>GatherBond / Commitment pass</span>
                <span>Testnet</span>
              </div>
              <div className="pass-art">
                <span className="pass-art-kicker">One room. One agreement.</span>
                <span className="pass-art-number">01</span>
                <span className="pass-art-ring pass-art-ring--one" aria-hidden="true" />
                <span className="pass-art-ring pass-art-ring--two" aria-hidden="true" />
                <span className="pass-art-footer">
                  DEPOSIT
                  <br />
                  SHOW UP · SETTLE
                </span>
              </div>
              <div className="pass-card-bottom">
                <div>
                  <strong>Escrow, not promises.</strong>
                  <span>NEAR Testnet contract</span>
                </div>
                <div className="pass-stub">
                  REAL
                  <br />
                  ON-CHAIN
                </div>
              </div>
            </article>

            <span className="pass-sticker" aria-hidden="true">
              SHOW
              <br />
              UP.
            </span>
            <span className="pass-note">Every listing is a verified contract event</span>
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

      <Discover
        initial={
          listings ? { events: listings.events, skipped: listings.skipped } : null
        }
      />

      <section className="section how-section" id="how">
        <div className="shell">
          <div className="section-head">
            <div>
              <p className="eyebrow">03 / The mechanic</p>
              <h2 className="section-title">
                Three moments.
                <br />
                <em>One honest agreement.</em>
              </h2>
            </div>
            <p className="section-copy">
              A deposit, a check-in, a deadline. Everything else is a rule you can read before
              you commit.
            </p>
          </div>

          <div className="steps-grid">
            <article className="step">
              <span className="step-number">01</span>
              <h3>Put something on the line.</h3>
              <p>Reserve with the exact NEAR deposit. No card, no promise, no platform balance.</p>
              <span className="step-tail">Reserve</span>
            </article>
            <article className="step">
              <span className="step-number">02</span>
              <h3>Show up in the window.</h3>
              <p>Your one-time ticket is checked in by the organizer. Attendance becomes a fact.</p>
              <span className="step-tail">Check in</span>
            </article>
            <article className="step">
              <span className="step-number">03</span>
              <h3>Take the room with you.</h3>
              <p>Claim your deposit plus a share of the pool the no-shows left behind.</p>
              <span className="step-tail">Settle</span>
            </article>
          </div>

          <div className="how-note">
            <span className="how-note-mark">≠</span>
            <p>
              <strong>Refundable is a rule, not a vibe.</strong> The contract holds the deposit,
              the metadata database never does, and the organizer never touches the room.
            </p>
            <Link href="/studio#create" className="text-link">
              Create a real event
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      <section className="home-cta">
        <div className="shell home-cta-grid">
          <div>
            <p className="eyebrow">For organizers</p>
            <h2>
              Host the room
              <br />
              <em>you keep talking about.</em>
            </h2>
          </div>
          <div className="home-cta-copy">
            <p>
              Publish a verified room on NEAR. Set the bond. Let the contract keep the room
              honest.
            </p>
            <Link href="/studio#create" className="button button-dark">
              Open organizer studio
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
      </section>
      </main>
    </>
  );
}
