import { revalidatePath } from "next/cache";

import { getRuntimeContext } from "../../../../../../../server/http/nextRuntime.mjs";
import {
  adminJson,
  isAdminMutationRequest,
  requireAdmin,
} from "../../../../../../../server/admin/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function revalidateEventSurfaces(eventId) {
  for (const [path, type] of [
    ["/", "layout"],
    [`/events/${eventId}`, "page"],
    [`/events/${eventId}/recap`, "page"],
    ["/sitemap.xml", "page"],
  ]) {
    try {
      revalidatePath(path, type);
    } catch {
      // The moderation write already succeeded. A stale cache is corrected by the next
      // request or revalidation cycle; never report a rollback that did not happen.
    }
  }
  try {
    // The social card is a separately cacheable route, so the event page purge alone
    // does not clear a previously generated card for a newly hidden event.
    revalidatePath(`/events/${eventId}/opengraph-image`);
  } catch {
    // Same rule as above: the moderation write is already committed.
  }
}

export async function POST(request, context) {
  if (!isAdminMutationRequest(request)) {
    return adminJson(403, { error: "cross_origin_request" });
  }

  const params = await context?.params;
  const eventId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  if (typeof eventId !== "string" || !/^\d+$/.test(eventId)) {
    return adminJson(400, { error: "invalid_event_id" });
  }

  let runtime;
  try {
    runtime = await getRuntimeContext();
  } catch {
    return adminJson(503, { error: "runtime_unavailable" });
  }

  const gate = await requireAdmin(runtime, request);
  if (!gate.ok) {
    return gate.response;
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return adminJson(400, { error: "invalid_json" });
  }

  const result = await runtime.adminHandlers.moderate({
    eventId,
    action: body?.action,
    reason: body?.reason,
    confirm: body?.confirm,
    actor: gate.actor,
  });
  if (result.status === 200) {
    revalidateEventSurfaces(eventId);
  }
  return adminJson(result.status, result.body);
}
