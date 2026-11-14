// Framework-agnostic HTTP glue for the private moderation console.

import {
  adminCookie,
  clearedAdminCookie,
  isAdminAccount,
  isAdminMutationRequest,
  issueAdminToken,
  readAdminAccess,
  verifyAdminKey,
} from "./auth.mjs";

export function adminJson(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });
}

function baseError(context) {
  return {
    admin_configured: Array.isArray(context?.admin?.accounts) && context.admin.accounts.length > 0,
    key_required: context?.admin?.keyStatus === "configured",
  };
}

/** Require a real wallet session and allowlisted account. Does not require unlock. */
export async function requireAdminAccount(context, request) {
  let actor;
  try {
    actor = await context.getSessionActor(request);
  } catch {
    return { ok: false, response: adminJson(503, { error: "session_unavailable" }) };
  }
  if (!actor) {
    return {
      ok: false,
      response: adminJson(401, { error: "unauthorized", ...baseError(context) }),
    };
  }
  if (!isAdminAccount(actor, context.admin.accounts)) {
    return {
      ok: false,
      response: adminJson(403, { error: "forbidden", ...baseError(context) }),
    };
  }
  if (context.admin.keyStatus === "too_short") {
    return {
      ok: false,
      response: adminJson(503, { error: "admin_key_invalid", ...baseError(context) }),
    };
  }
  return { ok: true, actor };
}

/** Require the full gate, including the second factor when configured. */
export async function requireAdmin(context, request) {
  const account = await requireAdminAccount(context, request);
  if (!account.ok) {
    return account;
  }
  const access = readAdminAccess({
    request,
    actor: account.actor,
    accounts: context.admin.accounts,
    secret: context.admin.secret,
    key: context.admin.key,
  });
  if (!access.ok) {
    return {
      ok: false,
      response: adminJson(access.status, {
        error: access.error,
        key_required: access.key_required === true,
        ...baseError(context),
      }),
    };
  }
  return { ok: true, actor: account.actor };
}

export async function adminAccess(context, request) {
  const gate = await requireAdmin(context, request);
  if (!gate.ok) {
    return gate.response;
  }
  return adminJson(200, { account_id: gate.actor, ...baseError(context) });
}

export async function adminUnlock(context, request) {
  const account = await requireAdminAccount(context, request);
  if (!account.ok) {
    return account.response;
  }
  if (context.admin.keyStatus === "not_configured") {
    return adminJson(200, { unlocked: false, key_required: false });
  }

  // Key attempts are limited per allowlisted account, not per client IP. A caller can
  // spoof X-Forwarded-For, and the session already identifies the account.
  const limit = context.admin.unlockLimiter?.hit(`admin-unlock:${account.actor}`);
  if (limit && limit.allowed === false) {
    return adminJson(
      429,
      { error: "rate_limited", retry_after_seconds: limit.retryAfterSeconds },
      { "retry-after": String(limit.retryAfterSeconds) },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return adminJson(400, { error: "invalid_json" });
  }
  if (!verifyAdminKey(body?.key, context.admin.key)) {
    return adminJson(401, { error: "invalid_admin_key" });
  }

  let token;
  try {
    token = issueAdminToken({
      secret: context.admin.secret,
      accountId: account.actor,
      ttlSeconds: context.admin.ttlSeconds,
    });
  } catch {
    return adminJson(503, { error: "admin_unlock_unavailable" });
  }

  return adminJson(
    200,
    { unlocked: true, key_required: true, account_id: account.actor },
    {
      "set-cookie": adminCookie(token, {
        maxAgeSeconds: context.admin.ttlSeconds,
        secure: context.admin.secure === true,
      }),
    },
  );
}

export function adminLock(context) {
  return adminJson(
    200,
    { unlocked: false },
    {
      "set-cookie": clearedAdminCookie({
        secure: context?.admin?.secure === true,
      }),
    },
  );
}

export { isAdminMutationRequest };
