import { getAuthRoutes } from "../../../../../server/http/nextRuntime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const routes = await getAuthRoutes();
  return routes.login(request);
}

export async function GET(request) {
  const routes = await getAuthRoutes();
  return routes.session(request);
}

export async function DELETE(request) {
  const routes = await getAuthRoutes();
  return routes.logout(request);
}
