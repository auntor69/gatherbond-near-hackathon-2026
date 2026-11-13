import { siteUrl } from "../lib/site.js";

export default function manifest() {
  return {
    name: "GatherBond — Make plans. Keep them.",
    short_name: "GatherBond",
    description:
      "Refundable commitments for real-world gatherings on NEAR Testnet. Show up, get your bond back, and share the no-show pool.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f1ede4",
    theme_color: "#f1ede4",
    lang: "en",
    categories: ["events", "social", "productivity"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    id: siteUrl(),
  };
}
