// Shared event timing helpers. Contract timestamps arrive as nanosecond strings on
// some pages and ISO strings on others; one parser keeps "ended" consistent everywhere.

function numericTimestamp(value) {
  try {
    const numeric = typeof value === "bigint" ? value : BigInt(value);
    if (numeric < 0n) {
      return null;
    }
    // Contract timestamps are nanoseconds. Accept milliseconds and seconds too so a
    // caller cannot silently turn a valid instant into 1970 by passing the wrong shape.
    if (numeric >= 100_000_000_000_000_000n) {
      return Number(numeric / 1_000_000n);
    }
    if (numeric >= 1_000_000_000_000n) {
      return Number(numeric);
    }
    if (numeric >= 1_000_000_000n) {
      return Number(numeric) * 1000;
    }
    return Number(numeric);
  } catch {
    return null;
  }
}

export function timestampMs(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "bigint") {
    return numericTimestamp(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return null;
    }
    return numericTimestamp(BigInt(value));
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    return numericTimestamp(text);
  }
  // Date.parse is intentionally loose (`"1.5"` becomes a 2001 date). Event timestamps
  // are either ISO-like or numeric, so reject everything else before parsing.
  if (!/^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2})/.test(text)) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function eventStartsAt(event) {
  return timestampMs(event?.startAt ?? event?.start_at);
}

export function eventEndsAt(event) {
  return timestampMs(event?.endAt ?? event?.end_at);
}

export function eventCheckinOpenAt(event) {
  return timestampMs(event?.checkinOpen ?? event?.checkin_open);
}

export function eventCheckinCloseAt(event) {
  return timestampMs(event?.checkinClose ?? event?.checkin_close);
}

export function eventEnded(event, now = Date.now()) {
  const end = eventEndsAt(event);
  return end !== null && now >= end;
}

export function eventStarted(event, now = Date.now()) {
  const start = eventStartsAt(event);
  return start !== null && now >= start;
}

export function eventBelowFloor(event) {
  const registered = Number(event?.registered ?? 0);
  const checkedIn = Number(event?.checkedIn ?? event?.checked_in ?? 0);
  return registered > 0 && checkedIn * 5 < registered;
}

/**
 * The contract leaves an event Open until the first claim settles it. `ended` is
 * therefore a UI state, not a second contract status.
 */
export function eventLifecycle(event, now = Date.now()) {
  const status = String(event?.status ?? "Open");
  const ended = eventEnded(event, now);
  const started = eventStarted(event, now);
  const belowFloor = eventBelowFloor(event);
  const finalized = status === "Finalized";
  const cancelled = status === "Cancelled";
  const failedStatus = status === "Failed";
  const closed = cancelled || finalized || failedStatus || ended;
  const settlementPending = status === "Open" && ended;
  const refundsEveryone =
    cancelled || failedStatus || ((finalized || settlementPending) && belowFloor);
  return {
    status,
    ended,
    started,
    belowFloor,
    finalized,
    cancelled,
    failedStatus,
    closed,
    settlementPending,
    refundsEveryone,
    displayStatus: settlementPending
      ? Number(event?.registered ?? 0) === 0
        ? "Ended · no reservations"
        : "Ended · settlement pending"
      : status,
  };
}

export function eventCheckinState(event, now = Date.now()) {
  const lifecycle = eventLifecycle(event, now);
  const opensAt = eventCheckinOpenAt(event);
  const closesAt = eventCheckinCloseAt(event);
  if (lifecycle.status !== "Open") {
    return { allowed: false, reason: "closed", opensAt, closesAt, lifecycle };
  }
  if (opensAt === null || closesAt === null) {
    return { allowed: false, reason: "unavailable", opensAt, closesAt, lifecycle };
  }
  if (now < opensAt) {
    return { allowed: false, reason: "not_open", opensAt, closesAt, lifecycle };
  }
  if (now > closesAt) {
    return { allowed: false, reason: "closed", opensAt, closesAt, lifecycle };
  }
  return { allowed: true, reason: null, opensAt, closesAt, lifecycle };
}

export function eventClaimState(event, reservation, now = Date.now()) {
  const lifecycle = eventLifecycle(event, now);
  const checkedIn = Boolean(reservation?.checked_in ?? reservation?.checkedIn);
  const claim = String(reservation?.claim ?? "");
  const canSettle =
    lifecycle.finalized ||
    lifecycle.cancelled ||
    lifecycle.failedStatus ||
    lifecycle.settlementPending;
  return {
    lifecycle,
    checkedIn,
    refundsEveryone: lifecycle.refundsEveryone,
    canClaim:
      Boolean(reservation) &&
      claim === "Unclaimed" &&
      canSettle &&
      (lifecycle.refundsEveryone || checkedIn),
  };
}
