// Pure Flake Fund math. No React, no browser globals, no floating-point money.
//
// The contract's finalize rule is:
//   pool = (registered - checked_in) * deposit
//   reward_per_attendee = floor(pool / checked_in)   when checked_in > 0
//   remainder = pool - reward_per_attendee * checked_in
//
// Before finalization the page must not invent a settlement. It can show a clearly
// labelled projection; the components do that, not this module.

const ZERO = 0n;
const BPS_DENOMINATOR = 10_000n;
const DEFAULT_PROJECTED_NO_SHOW_BPS = 2_000n; // 20%

export function toBigInt(value) {
  if (value === null || value === undefined || value === "") {
    return ZERO;
  }
  try {
    const next = BigInt(String(value));
    return next > ZERO ? next : ZERO;
  } catch {
    return ZERO;
  }
}

function toCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }
  return Math.floor(number);
}

export function showUpRate(registered, checkedIn) {
  const total = toCount(registered);
  if (total === 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, toCount(checkedIn) / total));
}

export function formatShowUpRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0) {
    return "0%";
  }
  return `${Math.round(rate * 100)}%`;
}

/**
 * Returns the contract-derived settlement or an explicitly projected open-event view.
 *
 * `state` is one of:
 * - `empty`: no reservations or no deposit yet
 * - `waiting`: fewer than two reservations, so a no-show pool has no recipient
 * - `open`: projection only; the event has not finalized
 * - `finalized`: actual settlement snapshot from contract fields
 * - `cancelled`: every registered attendee gets the deposit back
 */
export function flakeFundSummary({
  deposit,
  registered,
  checkedIn,
  status = "Open",
  projectedNoShowBps = DEFAULT_PROJECTED_NO_SHOW_BPS,
} = {}) {
  const depositYocto = toBigInt(deposit);
  const registeredCount = toCount(registered);
  const checkedInCount = Math.min(registeredCount, toCount(checkedIn));
  const normalizedStatus = String(status || "Open");
  const base = {
    deposit: depositYocto,
    registered: registeredCount,
    checkedIn: checkedInCount,
    status: normalizedStatus,
    showUpRate: showUpRate(registeredCount, checkedInCount),
    flakes: Math.max(0, registeredCount - checkedInCount),
    pool: ZERO,
    rewardPerAttendee: ZERO,
    totalRefund: ZERO,
    totalReturned: ZERO,
    remainder: ZERO,
    projectedFlakes: 0,
    projectedPool: ZERO,
    projectedReward: ZERO,
    oneFlakeReward: ZERO,
  };

  if (registeredCount === 0 || depositYocto === ZERO) {
    return { ...base, state: "empty" };
  }

  if (normalizedStatus === "Cancelled") {
    return {
      ...base,
      state: "cancelled",
      totalRefund: depositYocto * BigInt(registeredCount),
    };
  }

  if (normalizedStatus === "Finalized") {
    const flakes = Math.max(0, registeredCount - checkedInCount);
    const pool = BigInt(flakes) * depositYocto;
    const rewardPerAttendee =
      checkedInCount > 0 ? pool / BigInt(checkedInCount) : ZERO;
    const totalRefund = BigInt(checkedInCount) * depositYocto;
    const totalRewards = rewardPerAttendee * BigInt(checkedInCount);
    const remainder = pool - totalRewards;
    return {
      ...base,
      state: "finalized",
      flakes,
      pool,
      rewardPerAttendee,
      totalRefund,
      totalReturned: totalRefund + totalRewards,
      remainder,
    };
  }

  if (registeredCount < 2) {
    return { ...base, state: "waiting" };
  }

  const bps = BigInt(
    Math.min(10_000, Math.max(1, Math.round(Number(projectedNoShowBps) || 0))),
  );
  const rawProjectedFlakes = Number(
    (BigInt(registeredCount) * bps + BPS_DENOMINATOR / 2n) / BPS_DENOMINATOR,
  );
  const projectedFlakes = Math.min(
    registeredCount - 1,
    Math.max(1, rawProjectedFlakes),
  );
  const projectedAttendees = registeredCount - projectedFlakes;
  const projectedPool = BigInt(projectedFlakes) * depositYocto;
  const projectedReward =
    projectedAttendees > 0
      ? projectedPool / BigInt(projectedAttendees)
      : ZERO;
  const oneFlakeReward =
    registeredCount > 1
      ? depositYocto / BigInt(registeredCount - 1)
      : ZERO;

  return {
    ...base,
    state: "open",
    projections: {
      noShowBps: Number(bps),
      flakes: projectedFlakes,
      attendees: projectedAttendees,
      pool: projectedPool,
      rewardPerAttendee: projectedReward,
    },
    projectedFlakes,
    projectedPool,
    projectedReward,
    oneFlakeReward,
  };
}
