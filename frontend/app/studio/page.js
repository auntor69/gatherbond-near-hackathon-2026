import Studio from "../../components/studio";

export const metadata = {
  title: "Organizer studio",
  description: "Verify a draft, publish a snapshot and keep the public room in sync.",
  alternates: { canonical: "/studio" },
  robots: { index: false, follow: false },
};

export default function StudioPage() {
  return <Studio />;
}
