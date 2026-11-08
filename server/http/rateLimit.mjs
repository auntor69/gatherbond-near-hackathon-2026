// Process-local fixed-window rate limiting.
//
// Why process-local: the app already runs as one Node server locally and the task
// forbids a new service or dependency. A shared limiter would need Redis/Turso writes on
// every attempt; that is deliberately out of scope here. Consequence: each Next process
// has its own counters, so multiple instances/serverless replicas can each allow the full
// limit. That is documented in BUILD_LOG.md; a durable limiter can replace this module
// later without changing the call sites.
//
// Limits are fixed windows (default 60s). Every attempt counts, including failed
// signature verification, replay and wrong-actor writes, so garbage cannot be used to
// probe indefinitely. Over-limit responses are 429 with Retry-After.

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = 10_000,
} = {}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("createRateLimiter requires a positive integer limit");
  }
  if (!Number.isFinite(windowMs) || windowMs < 1) {
    throw new Error("createRateLimiter requires a positive window");
  }

  const buckets = new Map();

  return {
    hit(key) {
      const at = now();
      let bucket = buckets.get(key);

      if (!bucket || at >= bucket.resetAt) {
        if (!bucket && buckets.size >= maxKeys) {
          // Reclaim expired keys first; if the table is still full, fail closed for new
          // keys instead of evicting an active bucket and weakening an existing limit.
          for (const [candidate, value] of buckets) {
            if (at >= value.resetAt) {
              buckets.delete(candidate);
            }
          }
          if (buckets.size >= maxKeys) {
            return {
              allowed: false,
              limit,
              remaining: 0,
              retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
            };
          }
        }
        bucket = { count: 0, resetAt: at + windowMs };
        buckets.set(key, bucket);
      }

      bucket.count += 1;
      const allowed = bucket.count <= limit;
      return {
        allowed,
        limit,
        remaining: Math.max(0, limit - bucket.count),
        retryAfterSeconds: allowed
          ? 0
          : Math.max(1, Math.ceil((bucket.resetAt - at) / 1000)),
        resetAt: bucket.resetAt,
      };
    },

    get size() {
      return buckets.size;
    },
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

/** Explicit, safe-by-default limits. Invalid values fall back rather than disabling. */
export function readRateLimitConfig(env = process.env) {
  const loginWindowSeconds = positiveInteger(env.GATHERBOND_LOGIN_RATE_WINDOW_SECONDS, 60);
  return {
    disabled: env.GATHERBOND_RATE_LIMIT_DISABLED === "1",
    login: {
      limit: positiveInteger(env.GATHERBOND_LOGIN_RATE_LIMIT, 10),
      windowMs: loginWindowSeconds * 1000,
    },
    loginAccount: {
      limit: positiveInteger(env.GATHERBOND_LOGIN_ACCOUNT_RATE_LIMIT, 10),
      windowMs: loginWindowSeconds * 1000,
    },
    write: {
      limit: positiveInteger(env.GATHERBOND_WRITE_RATE_LIMIT, 30),
      windowMs: positiveInteger(env.GATHERBOND_WRITE_RATE_WINDOW_SECONDS, 60) * 1000,
    },
  };
}

function allowAll() {
  return { allowed: true, remaining: Infinity, retryAfterSeconds: 0 };
}

export function createRateLimiters(config = readRateLimitConfig({})) {
  if (config.disabled) {
    return {
      disabled: true,
      login: { checkClient: allowAll, checkAccount: allowAll },
      write: allowAll,
    };
  }

  const clients = createRateLimiter(config.login);
  const accounts = createRateLimiter(config.loginAccount);
  const writes = createRateLimiter(config.write);

  return {
    disabled: false,
    login: {
      checkClient(key) {
        return clients.hit(`client:${key}`);
      },
      checkAccount(key) {
        return accounts.hit(`account:${key}`);
      },
    },
    write(actor) {
      return writes.hit(`write:${actor}`);
    },
  };
}

/**
 * Best-effort client identity for throttling. Behind a trusted proxy this is the first
 * X-Forwarded-For hop; direct clients can spoof the header, which is why logins are also
 * throttled per account id. The local fallback shares one bucket.
 */
export function clientKey(request) {
  const forwarded = request?.headers?.get?.("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.trim() !== "") {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request?.headers?.get?.("x-real-ip");
  if (typeof realIp === "string" && realIp.trim() !== "") {
    return realIp.trim();
  }
  return "unknown";
}

export function rateLimitedResponse(result) {
  const seconds = Math.max(1, Math.ceil(Number(result?.retryAfterSeconds) || 1));
  return new Response(
    JSON.stringify({ error: "rate_limited", retry_after_seconds: seconds }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": String(seconds),
      },
    },
  );
}
