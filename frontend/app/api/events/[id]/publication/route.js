import { revalidatePath } from "next/cache";

import { getMetadataRoutes } from "../../../../../../server/http/nextRuntime.mjs";
import { publicationRevalidationTargets } from "../../../../../lib/publicationRevalidation.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  const routes = await getMetadataRoutes();
  return routes.getPublication(request, context);
}

function revalidatePublication(eventId) {
  for (const target of publicationRevalidationTargets(eventId)) {
    try {
      if (target.type) {
        revalidatePath(target.path, target.type);
      } else {
        revalidatePath(target.path);
      }
    } catch {
      // The publication already succeeded. A stale cache must not turn into a 500,
      // and the next deploy/request will regenerate the missing surface.
    }
  }
}

async function eventIdFrom(context) {
  const params = await context?.params;
  return Array.isArray(params?.id) ? params.id[0] : params?.id;
}

export async function POST(request, context) {
  const routes = await getMetadataRoutes();
  const response = await routes.publish(request, context);
  if (response.ok) {
    revalidatePublication(await eventIdFrom(context));
  }
  return response;
}

// No DELETE handler: publications are permanent. Attempts receive 405 from Next.js.
