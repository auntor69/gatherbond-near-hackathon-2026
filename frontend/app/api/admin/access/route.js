import { getRuntimeContext } from "../../../../../server/http/nextRuntime.mjs";
import { adminAccess, adminJson } from "../../../../../server/admin/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  let context;
  try {
    context = await getRuntimeContext();
  } catch {
    return adminJson(503, { error: "runtime_unavailable" });
  }
  return adminAccess(context, request);
}
