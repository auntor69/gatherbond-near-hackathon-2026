import { jsonLdString } from "../lib/seo.js";

export default function JsonLd({ data }) {
  if (!data) {
    return null;
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdString(data) }}
    />
  );
}
