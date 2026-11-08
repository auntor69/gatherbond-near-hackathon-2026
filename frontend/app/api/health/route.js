import { getMetadataRoutes, getRuntimeStatus } from "../../../../server/http/nextRuntime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getRuntimeStatus();
  let databaseRead = "failed";
  try {
    const routes = await getMetadataRoutes();
    const probe = await routes.list(new Request("https://health.invalid/api/events?limit=0"));
    databaseRead = probe.status === 200 ? "ok" : "failed";
  } catch {
    databaseRead = "failed";
  }

  return new Response(
    JSON.stringify({
      ...status,
      database_read: databaseRead,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
