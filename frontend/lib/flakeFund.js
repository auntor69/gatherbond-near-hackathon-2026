// Pure no-show-pool math. No React, no browser globals, no floating-point money.
//
// The contract settles when the first claim is made after the event ends:
//   below 20% attendance (checked_in * 5 < registered): every deposit is refunded
//   otherwise: pool = (registered - checked_in) * deposit, split equally
//   reward_per_attendee = floor(pool / checked_in)   when checked_in > 0
//   remainder = pool - reward_per_attendee * checked_in
//
// Before settlement the page must not invent a settlement. It can show a clearly
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
  return `${Math.round(Math.min(1, rate) * 100)}%`;
}

/**
 * Returns the contract-derived settlement or an explicitly projected open-event view.
 *
 * `state` is one of:
 * - `empty`: no reservations or no deposit yet
 * - `waiting`: fewer than two reservations, so a no-show pool has no recipient
 * - `open`: projection only; the event has not settled
 * - `finalized`: actual settlement snapshot from contract fields
 * - `failed`: below 20% attendance; every registered attendee gets the deposit back
 * - `cancelled`: every registered attendee gets the deposit back
 * - `ended`: the event has ended, but the first attendee claim has not settled it yet
 */
export function flakeFundSummary({
  deposit,
  registered,
  checkedIn,
  status = "Open",
  ended = false,
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

  // Settlement status wins over an empty room. A cancelled event with no
  // reservations is still cancelled; it must not be presented as an open room
  // that is merely waiting for its first attendee.
  if (normalizedStatus === "Cancelled") {
    return {
      ...base,
      state: "cancelled",
      totalRefund: depositYocto * BigInt(registeredCount),
    };
  }

  if (normalizedStatus === "Failed") {
    const refund = depositYocto * BigInt(registeredCount);
    return {
      ...base,
      state: "failed",
      totalRefund: refund,
      totalReturned: refund,
    };
  }

  if (normalizedStatus === "Finalized") {
    const belowFloor =
      registeredCount > 0 && checkedInCount * 5 < registeredCount;
    if (belowFloor) {
      const refund = depositYocto * BigInt(registeredCount);
      return {
        ...base,
        state: "failed",
        totalRefund: refund,
        totalReturned: refund,
      };
    }
    if (checkedInCount === 0) {
      return { ...base, state: "finalized" };
    }
    const flakes = Math.max(0, registeredCount - checkedInCount);
    const pool = BigInt(flakes) * depositYocto;
    const rewardPerAttendee = pool / BigInt(checkedInCount);
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

  // The contract keeps an event Open until the first claim settles it. Do not show a
  // projection here: attendance is already final, and settlement is one claim away.
  if (normalizedStatus === "Open" && ended) {
    const refundsEveryone =
      registeredCount > 0 && checkedInCount * 5 < registeredCount;
    const refund = refundsEveryone
      ? depositYocto * BigInt(registeredCount)
      : ZERO;
    return {
      ...base,
      state: "ended",
      refundsEveryone,
      totalRefund: refund,
      totalReturned: refund,
    };
  }

  if (registeredCount === 0 || depositYocto === ZERO) {
    return { ...base, state: "empty" };
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
