import EventDetail from "../../../components/event-detail";

export const metadata = {
  title: "Event passport",
};

export default async function EventPage({ params }) {
  const { id } = await params;
  return <EventDetail id={id} />;
}
