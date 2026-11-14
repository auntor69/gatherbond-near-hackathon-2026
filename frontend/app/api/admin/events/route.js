import { getRuntimeContext } from "../../../../../server/http/nextRuntime.mjs";
import { adminJson, requireAdmin } from "../../../../../server/admin/http.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  let context;
  try {
    context = await getRuntimeContext();
  } catch {
    return adminJson(503, { error: "runtime_unavailable" });
  }

  const gate = await requireAdmin(context, request);
  if (!gate.ok) {
    return gate.response;
  }

  let limit = 200;
  try {
    limit = Number(new URL(request.url).searchParams.get("limit")) || 200;
  } catch {
    limit = 200;
  }
  const result = await context.adminHandlers.list({ limit });
  return adminJson(result.status, result.body);
}
