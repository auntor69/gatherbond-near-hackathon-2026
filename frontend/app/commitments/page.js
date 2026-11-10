import Commitments from "../../components/commitments";

export const metadata = {
  title: "My commitments",
  description: "Reservations, one-time tickets and settlement state read from the NEAR contract.",
};

export default function CommitmentsPage() {
  return <Commitments />;
}
