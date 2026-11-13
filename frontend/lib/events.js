const DATE_FORMAT = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const DAY_FORMAT = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "2-digit",
  timeZone: "UTC",
});

const MONTH_FORMAT = new Intl.DateTimeFormat("en", {
  month: "short",
  timeZone: "UTC",
});

const NUMBER_FORMAT = new Intl.NumberFormat("en", {
  maximumFractionDigits: 2,
});

const CATEGORY_ACCENTS = ["lime", "coral", "violet", "blue"];

export function accentForCategory(category = "") {
  let total = 0;
  for (let index = 0; index < category.length; index += 1) {
    total += category.charCodeAt(index);
  }
  return CATEGORY_ACCENTS[total % CATEGORY_ACCENTS.length];
}

export function formatDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return DATE_FORMAT.format(date);
}

export function formatDay(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return DAY_FORMAT.format(date);
}

export function formatMonth(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return MONTH_FORMAT.format(date).toUpperCase();
}

export function formatNear(yoctoNear) {
  if (yoctoNear === null || yoctoNear === undefined || yoctoNear === "") {
    return null;
  }
  try {
    const value = Number(BigInt(String(yoctoNear))) / 1e24;
    return `${NUMBER_FORMAT.format(value)} NEAR`;
  } catch {
    return null;
  }
}

function nanosecondsToIso(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  try {
    const milliseconds = BigInt(String(value)) / 1_000_000n;
    return new Date(Number(milliseconds)).toISOString();
  } catch {
    return null;
  }
}

export function statusLabel(status) {
  if (!status) {
    return "On-chain";
  }
  return String(status)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

export function shortHash(value, head = 10, tail = 6) {
  if (!value || typeof value !== "string") {
    return "—";
  }
  if (value.length <= head + tail + 1) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function shortAccount(value, head = 8, tail = 5) {
  if (!value || typeof value !== "string") {
    return "Wallet";
  }
  if (value.length <= head + tail + 2) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function mapListing(item) {
  const metadata = item?.metadata ?? {};
  const onchain = item?.onchain ?? null;
  return {
    id: String(item?.event?.event_id ?? ""),
    title: metadata.title ?? "Untitled event",
    description: metadata.description ?? "",
    category: metadata.category ?? "Event",
    venue: metadata.venue ?? "Venue to be announced",
    organizer: metadata.organizer_account_id ?? "Organizer",
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    imageUrl: metadata.image_url ?? "",
    publishedAt: item?.published_at ?? null,
    version: item?.publication_version ?? 0,
    hash: item?.metadata_sha256 ?? null,
    createTxHash: item?.create_tx_hash ?? null,
    network: item?.event?.network_id ?? "testnet",
    contractId: item?.event?.contract_id ?? null,
    startAt: nanosecondsToIso(onchain?.start_at),
    endAt: nanosecondsToIso(onchain?.end_at),
    registrationDeadline: nanosecondsToIso(onchain?.registration_deadline),
    checkinOpen: nanosecondsToIso(onchain?.checkin_open),
    checkinClose: nanosecondsToIso(onchain?.checkin_close),
    deposit: onchain?.deposit ?? null,
    capacity: onchain?.capacity ?? null,
    registered: onchain?.registered ?? null,
    checkedIn: onchain?.checked_in ?? null,
    status: onchain?.status ?? "Published",
    onchain,
    accent: accentForCategory(metadata.category ?? ""),
  };
}

export function mapDetail(body) {
  const listing = mapListing({
    ...body,
    publication_version: body?.version,
    metadata_sha256: body?.metadata_sha256,
  });
  const onchain = body?.onchain ?? null;
  return {
    ...listing,
    version: body?.version ?? 0,
    publishedAt: body?.published_at ?? null,
    publishedBy: body?.published_by ?? null,
    hash: body?.metadata_sha256 ?? null,
    createTxHash: body?.create_tx_hash ?? null,
    rewardPerAttendee: onchain?.reward_per_attendee ?? null,
    rewardPool: onchain?.reward_pool ?? null,
    refundPool: onchain?.refund_pool ?? null,
  };
}

export function eventWhenLabel(event) {
  if (event.startAt) {
    return formatDate(event.startAt);
  }
  if (event.publishedAt) {
    return `Listed ${formatDate(event.publishedAt)}`;
  }
  return "Schedule on-chain";
}

export function calendarFile(event) {
  if (!event.startAt) {
    return null;
  }
  const stamp = (value) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const end = event.endAt ?? new Date(new Date(event.startAt).getTime() + 2 * 60 * 60 * 1000).toISOString();
  const escape = (value) => String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GatherBond//Event//EN",
    "BEGIN:VEVENT",
    `UID:${event.id}@gatherbond`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.startAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(event.description)}`,
    `LOCATION:${escape(event.venue)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
