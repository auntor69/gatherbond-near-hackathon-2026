// Browser-side contract helpers. No server secret is read here.

const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;
const TICKET_PREFIX = "gatherbond.ticket.v1";

export function parseNear(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,24})?$/.test(text)) {
    throw new Error("Enter a positive NEAR amount");
  }
  const [whole, fraction = ""] = text.split(".");
  const padded = fraction.padEnd(24, "0").slice(0, 24);
  const yocto = BigInt(whole) * YOCTO_PER_NEAR + BigInt(padded || "0");
  if (yocto <= 0n) {
    throw new Error("Amount must be greater than zero");
  }
  return yocto.toString();
}

export function formatNearAmount(yocto) {
  if (yocto === null || yocto === undefined || yocto === "") {
    return "—";
  }
  try {
    const value = BigInt(String(yocto));
    const whole = value / YOCTO_PER_NEAR;
    const fraction = (value % YOCTO_PER_NEAR).toString().padStart(24, "0").replace(/0+$/, "");
    if (!fraction) {
      return `${whole} NEAR`;
    }
    const display = fraction.slice(0, 4).padEnd(4, "0");
    if (whole === 0n && display === "0000") {
      return "<0.0001 NEAR";
    }
    return `${whole}.${display} NEAR`;
  } catch {
    return "—";
  }
}

export function toNanoseconds(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Choose a valid date and time");
  }
  return (BigInt(timestamp) * 1_000_000n).toString();
}

export function toLocalInput(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function scheduleError(form) {
  const fields = ["registration_deadline", "start_at", "end_at", "checkin_open", "checkin_close"];
  const times = {};
  for (const field of fields) {
    const value = Date.parse(form?.[field]);
    if (!Number.isFinite(value)) {
      return "Choose a valid registration deadline, start, end and check-in window.";
    }
    times[field] = value;
  }
  if (times.start_at <= Date.now()) {
    return "The event start must be in the future.";
  }
  if (times.end_at <= times.start_at) {
    return "The event end must be after the start.";
  }
  if (times.registration_deadline <= Date.now()) {
    return "Registration must close in the future.";
  }
  if (times.registration_deadline > times.start_at) {
    return "Registration must close no later than the event start.";
  }
  if (times.checkin_open < times.registration_deadline) {
    return "Check-in cannot open before registration closes.";
  }
  if (times.checkin_close <= times.checkin_open) {
    return "Check-in must close after it opens.";
  }
  if (times.checkin_close > times.end_at) {
    return "Check-in must close no later than the event ends.";
  }
  return null;
}

/**
 * @deprecated Use `defaultEventWindow` plus `eventWindowFrom`. Kept as a thin adapter so
 * every producer of a schedule goes through the same fixed-window rule.
 */
export function defaultSchedule() {
  return eventWindowFrom(defaultEventWindow());
}

function localDateValue(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeValue(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Default date/start/end for a new event: next quarter hour plus two hours. */
export function defaultEventWindow() {
  const quarter = 15 * 60_000;
  const start = new Date(
    Math.ceil((Date.now() + 45 * 60_000) / quarter) * quarter,
  );
  // An evening default would end after midnight, which the contract rejects.
  if (start.getHours() >= 21) {
    start.setDate(start.getDate() + 1);
    start.setHours(18, 0, 0, 0);
  }
  const end = new Date(start.getTime() + 2 * 60 * 60_000);
  return {
    date: localDateValue(start),
    start_time: localTimeValue(start),
    end_time: localTimeValue(end),
  };
}

/**
 * The product rule: the organizer picks one date and the start/end times. Registration
 * closes when the event starts, check-in opens at the start, and both close at the end.
 * Returns the five timestamps `create_event` expects, or null when incomplete.
 */
export function eventWindowFrom({ date, start_time, end_time } = {}) {
  if (!date || !start_time || !end_time) return null;
  const start = new Date(`${date}T${start_time}`);
  const end = new Date(`${date}T${end_time}`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null;
  }
  const startAt = toLocalInput(start);
  const endAt = toLocalInput(end);
  return {
    registration_deadline: startAt,
    start_at: startAt,
    end_at: endAt,
    checkin_open: startAt,
    checkin_close: endAt,
  };
}

export function decodeOutcomeValue(result) {
  const raw =
    result?.status?.SuccessValue ??
    result?.status?.successValue ??
    result?.status?.Success_value ??
    null;
  if (!raw) {
    return null;
  }
  try {
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

export function outcomeHash(result) {
  return result?.transaction?.hash ?? result?.transaction_outcome?.id ?? null;
}

export function contractError(error) {
  const text = String(error?.message ?? error ?? "");
  if (/reject|cancel|denied|user closed/i.test(text)) {
    return "Wallet request cancelled. Nothing was sent.";
  }
  if (/insufficient.*balance|not enough balance/i.test(text)) {
    return "The wallet does not have enough NEAR for this deposit and gas.";
  }
  const known = [
    "Event capacity is full",
    "Already registered for this event",
    "Registration deadline has passed",
    "Exact deposit required",
    "Event is not open",
    "Event not found",
    "Only the event organizer can check in attendees",
    "Check-in window is closed",
    "Invalid ticket for this attendee",
    "Ticket already used",
    "No reservation for this attendee",
    "Settlement in flight for this event",
    "Event cannot be finalized before it ends",
    "Event is not finalized",
    "Reservation is not claimable",
  ];
  const match = known.find((message) => text.includes(message));
  return match ? `${match}. Nothing was changed.` : text || "The transaction failed. Nothing was changed.";
}

export function newTicketSecret() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encodeTicket({ networkId, contractId, eventId, attendee, secret }) {
  const payload = JSON.stringify({ v: 1, networkId, contractId, eventId: String(eventId), attendee, secret });
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `GB1.${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export function decodeTicket(code) {
  const text = String(code ?? "").trim();
  if (!text.startsWith("GB1.")) {
    throw new Error("That is not a GatherBond ticket code");
  }
  const base64 = text.slice(4).replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
  if (
    payload?.v !== 1 ||
    typeof payload.networkId !== "string" ||
    typeof payload.contractId !== "string" ||
    typeof payload.attendee !== "string" ||
    typeof payload.secret !== "string" ||
    !/^\d+$/.test(String(payload.eventId))
  ) {
    throw new Error("The ticket code is incomplete");
  }
  return { ...payload, eventId: String(payload.eventId) };
}

function keyFor({ networkId, contractId, eventId, attendee }) {
  return `${TICKET_PREFIX}:${networkId}:${contractId}:${eventId}:${attendee}`;
}

export function saveTicket(ticket) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(keyFor(ticket), JSON.stringify(ticket));
}

export function loadTicket(input) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(input));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function removeTicket(input) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(keyFor(input));
}

export function listTickets(accountId) {
  if (typeof window === "undefined" || !accountId) return [];
  const tickets = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(`${TICKET_PREFIX}:`)) continue;
    try {
      const ticket = JSON.parse(window.localStorage.getItem(key));
      if (ticket?.attendee === accountId) tickets.push(ticket);
    } catch {
      // Ignore corrupted local ticket entries.
    }
  }
  return tickets;
}
