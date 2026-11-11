"use client";

import { useEffect, useState } from "react";

import { formatNearAmount } from "../lib/contract";

async function loadQrLibrary() {
  const module = await import("qrcode");
  const library = module.default?.toDataURL ? module.default : module;
  if (typeof library?.toDataURL !== "function") {
    throw new Error("The QR renderer could not be loaded");
  }
  return library;
}

export async function ticketQrDataUrl(code, size = 320) {
  const QRCode = await loadQrLibrary();
  return QRCode.toDataURL(String(code ?? ""), {
    errorCorrectionLevel: "M",
    margin: 2,
    width: size,
    color: { dark: "#13120f", light: "#fffdf7" },
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The QR image could not be prepared"));
    image.src = src;
  });
}

function wrapWords(ctx, text, maxWidth, maxLines) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.length > lines.join(" ").split(/\s+/).length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, "")}…`;
  }
  return lines;
}

function wrapChars(ctx, text, maxWidth, maxLines) {
  const chars = Array.from(String(text ?? ""));
  const lines = [];
  let line = "";
  for (const char of chars) {
    if (ctx.measureText(line + char).width <= maxWidth) {
      line += char;
    } else {
      lines.push(line);
      line = char;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && chars.length > lines.join("").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
}

function fileNameFor(ticket) {
  const title = String(ticket.title || `event-${ticket.eventId}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `gatherbond-${title || "ticket"}-${ticket.eventId}.png`;
}

export async function downloadTicketImage(ticket) {
  const qr = await ticketQrDataUrl(ticket.code, 440);
  const image = await loadImage(qr);
  const canvas = document.createElement("canvas");
  canvas.width = 760;
  canvas.height = 980;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The ticket image could not be created");

  ctx.fillStyle = "#fffdf7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#13120f";
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

  ctx.fillStyle = "#13120f";
  ctx.font = "600 18px ui-monospace, Consolas, monospace";
  ctx.fillText("GATHERBOND / ONE-TIME TICKET", 48, 64);

  ctx.font = "500 42px Georgia, serif";
  wrapWords(ctx, ticket.title || `Event ${ticket.eventId}`, 664, 2).forEach((line, index) => {
    ctx.fillText(line, 48, 122 + index * 44);
  });

  ctx.font = "14px ui-monospace, Consolas, monospace";
  ctx.fillText(`EVENT #${ticket.eventId}`, 48, 228);
  ctx.drawImage(image, 160, 258, 440, 440);

  ctx.font = "16px ui-monospace, Consolas, monospace";
  ctx.fillText(`ATTENDEE  ${ticket.attendee}`, 48, 740);
  ctx.fillText(`DEPOSIT   ${formatNearAmount(ticket.deposit)}`, 48, 768);

  ctx.fillStyle = "#756e62";
  ctx.font = "13px ui-monospace, Consolas, monospace";
  ctx.fillText("Treat this like cash. Anyone with this QR can be checked in.", 48, 808);
  ctx.fillText("If this browser is lost, restore a new ticket from My commitments.", 48, 828);

  ctx.fillStyle = "#13120f";
  ctx.font = "11px ui-monospace, Consolas, monospace";
  wrapChars(ctx, ticket.code, 664, 4).forEach((line, index) => {
    ctx.fillText(line, 48, 862 + index * 16);
  });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The ticket image could not be encoded");

  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileNameFor(ticket);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1200);
}

export default function TicketQR({ code, size = 188, alt = "One-time ticket QR code" }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setSrc("");
    setFailed(false);
    ticketQrDataUrl(code, Math.max(256, size * 2))
      .then((dataUrl) => {
        if (active) setSrc(dataUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [code, size]);

  if (failed) {
    return <div className="ticket-qr ticket-qr--error">QR unavailable</div>;
  }
  if (!src) {
    return (
      <div className="ticket-qr ticket-qr--loading" aria-label="Rendering ticket QR">
        <span>Rendering QR…</span>
      </div>
    );
  }
  return (
    <img
      className="ticket-qr"
      src={src}
      width={size}
      height={size}
      alt={alt}
      style={{ width: size, height: size }}
    />
  );
}
