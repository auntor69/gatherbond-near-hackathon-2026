import { getMetadataRoutes } from "../../../../../../server/http/nextRuntime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  const routes = await getMetadataRoutes();
  return routes.getPublication(request, context);
}

export async function POST(request, context) {
  const routes = await getMetadataRoutes();
  return routes.publish(request, context);
}

// No DELETE handler: publications are permanent. Attempts receive 405 from Next.js.
