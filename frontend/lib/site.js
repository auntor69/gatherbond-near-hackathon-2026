// One canonical origin for metadata, JSON-LD, robots and the sitemap. Production can
// override it with NEXT_PUBLIC_SITE_URL; the fallback is the deployed hackathon URL.
export const DEFAULT_SITE_URL = "https://gatherbond.vercel.app";

export function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // Fall through to the known production origin rather than emitting a broken URL.
    }
  }
  return DEFAULT_SITE_URL;
}

export function absoluteUrl(path = "/") {
  if (!path) {
    return siteUrl();
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function eventPath(id) {
  return `/events/${encodeURIComponent(String(id ?? ""))}`;
}

export function recapPath(id) {
  return `${eventPath(id)}/recap`;
}
