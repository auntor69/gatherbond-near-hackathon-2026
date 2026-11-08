// Session routes: POST /api/auth/session (login), GET (who am I), DELETE (logout).
//
// The cookie is HttpOnly + SameSite=Lax and is the only actor source for metadata writes.
// A dev actor header is handled separately in server/metadata/runtime.mjs and only when
// GATHERBOND_ALLOW_DEV_ACTOR=1.

import { clientKey, rateLimitedResponse } from "../http/rateLimit.mjs";
import { AuthError, verifyLoginRequest } from "./login.mjs";
import {
  clearedSessionCookie,
  isSessionSecretConfigured,
  issueSessionToken,
  readSessionCookie,
  sessionCookie,
} from "./session.mjs";

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function createAuthRoutes({
  config = {},
  lookupAccessKey,
  nonceStore,
  rateLimitLogin,
  now = () => Date.now(),
} = {}) {
  const enabled = isSessionSecretConfigured(config.secret);

  return {
    async login(request) {
      if (!enabled) {
        return jsonResponse(503, { error: "auth_not_configured" });
      }

      // Throttle before parsing, signature verification or any RPC lookup. Failed
      // attempts count, so forged signatures and replays cannot be used to probe.
      const clientLimit = rateLimitLogin?.checkClient?.(clientKey(request));
      if (clientLimit && clientLimit.allowed === false) {
        return rateLimitedResponse(clientLimit);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse(400, { error: "invalid_json" });
      }

      const accountId =
        body !== null && typeof body === "object" && typeof body.account_id === "string"
          ? body.account_id
          : null;
      if (accountId) {
        const accountLimit = rateLimitLogin?.checkAccount?.(accountId);
        if (accountLimit && accountLimit.allowed === false) {
          return rateLimitedResponse(accountLimit);
        }
      }

      const at = now();
      try {
        const result = await verifyLoginRequest({
          body,
          recipient: config.recipient,
          lookupAccessKey,
          nonceStore,
        });
        const ttlSeconds = config.ttlSeconds ?? 7200;
        const token = issueSessionToken({
          secret: config.secret,
          accountId: result.accountId,
          ttlSeconds,
          now: at,
        });
        return jsonResponse(
          200,
          {
            account_id: result.accountId,
            expires_at: new Date((Math.floor(at / 1000) + ttlSeconds) * 1000).toISOString(),
          },
          {
            "set-cookie": sessionCookie(token, {
              maxAgeSeconds: ttlSeconds,
              secure: config.secure === true,
            }),
          },
        );
      } catch (error) {
        if (error instanceof AuthError) {
          return jsonResponse(error.status, { error: error.code, detail: error.message });
        }
        return jsonResponse(503, { error: "auth_unavailable" });
      }
    },

    async session(request) {
      const result = readSessionCookie(request, { secret: config.secret, now: now() });
      if (!result.accountId) {
        return jsonResponse(401, {
          error: result.reason === "expired" ? "session_expired" : "unauthorized",
        });
      }
      return jsonResponse(200, {
        account_id: result.accountId,
        expires_at: new Date(result.expiresAt * 1000).toISOString(),
      });
    },

    async logout() {
      return new Response(null, {
        status: 204,
        headers: {
          "set-cookie": clearedSessionCookie({ secure: config.secure === true }),
          "cache-control": "no-store",
        },
      });
    },
  };
}
