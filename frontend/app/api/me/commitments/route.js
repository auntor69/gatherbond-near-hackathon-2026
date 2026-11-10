import { getRuntimeContext } from "../../../../../server/http/nextRuntime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET(request) {
  let context;
  try {
    context = await getRuntimeContext();
  } catch {
    return json(503, { error: "runtime_unavailable" });
  }

  let actor;
  try {
    actor = await context.getActor(request);
  } catch {
    return json(503, { error: "session_unavailable" });
  }
  if (!actor) {
    return json(401, { error: "unauthorized" });
  }
  if (!context.reader) {
    return json(503, { error: "contract_not_configured" });
  }

  try {
    const reservations = await context.reader.getReservationsForAccount(actor, 0, 20);
    const items = await Promise.all(
      (Array.isArray(reservations) ? reservations : []).map(async (reservation) => {
        let onchain = null;
        try {
          onchain = await context.reader.getEvent(reservation.event_id);
        } catch {
          onchain = null;
        }
        return { reservation, onchain };
      }),
    );
    return json(200, { account_id: actor, items });
  } catch {
    return json(503, { error: "chain_unavailable" });
  }
}
