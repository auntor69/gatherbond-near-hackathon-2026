import { siteUrl } from "../lib/site.js";

export default function robots() {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/studio", "/commitments"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
