import EventRecap from "../../../../components/event-recap";

export const metadata = {
  title: "Room proof",
  description: "Public attendance and Flake Fund settlement verified by the NEAR contract.",
};

export default async function EventRecapPage({ params }) {
  const { id } = await params;
  return <EventRecap id={id} />;
}
