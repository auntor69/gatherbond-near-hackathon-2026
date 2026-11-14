import AdminPanel from "../../components/admin-panel";
import "./admin.css";

export const metadata = {
  title: "Private moderation",
  description: "Allowlisted event moderation — not a public page.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminPanel />;
}
