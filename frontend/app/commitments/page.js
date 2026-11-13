import Commitments from "../../components/commitments";

export const metadata = {
  title: "My commitments",
  description: "Reservations, one-time tickets and settlement state read from the NEAR contract.",
  alternates: { canonical: "/commitments" },
  robots: { index: false, follow: false },
};

export default function CommitmentsPage() {
  return <Commitments />;
}
