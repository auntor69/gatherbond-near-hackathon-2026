import { getRuntimeContext } from "../../../../../server/http/nextRuntime.mjs";
import {
  adminJson,
  adminLock,
  adminUnlock,
  isAdminMutationRequest,
} from "../../../../../server/admin/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!isAdminMutationRequest(request)) {
    return adminJson(403, { error: "cross_origin_request" });
  }
  let context;
  try {
    context = await getRuntimeContext();
  } catch {
    return adminJson(503, { error: "runtime_unavailable" });
  }
  return adminUnlock(context, request);
}

export async function DELETE(request) {
  if (!isAdminMutationRequest(request)) {
    return adminJson(403, { error: "cross_origin_request" });
  }
  let context;
  try {
    context = await getRuntimeContext();
  } catch {
    return adminJson(503, { error: "runtime_unavailable" });
  }
  return adminLock(context);
}
