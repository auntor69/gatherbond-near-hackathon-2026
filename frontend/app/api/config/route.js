import { getRuntimeContext } from "../../../../server/http/nextRuntime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await getRuntimeContext();
    return new Response(
      JSON.stringify({
        network_id: context.networkId,
        contract_id: context.contractId,
        contract_configured: Boolean(context.contractId),
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  } catch {
    return new Response(JSON.stringify({ error: "config_unavailable" }), {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}
