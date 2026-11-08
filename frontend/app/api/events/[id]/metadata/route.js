import { getMetadataRoutes } from "../../../../../../server/http/nextRuntime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  const routes = await getMetadataRoutes();
  return routes.get(request, context);
}

export async function PUT(request, context) {
  const routes = await getMetadataRoutes();
  return routes.put(request, context);
}
