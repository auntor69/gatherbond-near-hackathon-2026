import Link from "next/link";

import { ArrowRight } from "../components/icons";

export default function NotFound() {
  return (
    <main className="state-page">
      <div className="state-card">
        <p className="eyebrow">404 — empty room</p>
        <h1>This room is empty.</h1>
        <p>The page is not on the shelf. The good rooms are this way.</p>
        <Link href="/" className="button button-dark">
          Back to GatherBond
          <ArrowRight size={16} />
        </Link>
      </div>
    </main>
  );
}
