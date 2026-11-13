import { ImageResponse } from "next/og";

import { eventWhenLabel } from "../../../lib/events.js";
import { loadPublishedEvent } from "../../../lib/serverEvents.mjs";

export const alt = "A verified GatherBond room on NEAR Testnet";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

export default async function Image({ params }) {
  const { id } = await params;
  const result = await loadPublishedEvent(id);
  const event = result.status === "ready" ? result.event : null;
  const title = event?.title ?? "Room unavailable";
  const when = event ? eventWhenLabel(event) : "Verified rooms only";
  const venue = event?.venue ?? "GatherBond / NEAR Testnet";
  const category = event?.category ?? "Event passport";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0e100e",
          color: "#f1ede4",
          padding: "60px 68px",
          position: "relative",
          overflow: "hidden",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: "680px",
            height: "680px",
            borderRadius: "50%",
            border: "2px solid rgba(215,255,95,0.28)",
            top: "-300px",
            right: "-220px",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: "420px",
            height: "420px",
            borderRadius: "50%",
            background: "rgba(255,92,53,0.12)",
            bottom: "-220px",
            left: "-120px",
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "46px",
                height: "46px",
                borderRadius: "12px",
                background: "#d7ff5f",
                color: "#0e100e",
                fontSize: "20px",
                fontWeight: 700,
              }}
            >
              GB
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "18px",
                letterSpacing: "2.5px",
                color: "rgba(241,237,228,0.7)",
              }}
            >
              GATHERBOND / EVENT PASSPORT
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "8px 14px",
              border: "1px solid rgba(215,255,95,0.45)",
              borderRadius: "999px",
              fontSize: "15px",
              letterSpacing: "1.5px",
              color: "#d7ff5f",
            }}
          >
            VERIFIED PUBLICATION
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: "17px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "#d7ff5f",
              marginBottom: "18px",
            }}
          >
            {category}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: title.length > 34 ? "60px" : "78px",
              fontWeight: 700,
              letterSpacing: "-3px",
              lineHeight: 1.02,
              maxWidth: "980px",
              maxHeight: "170px",
              overflow: "hidden",
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              gap: "30px",
              marginTop: "28px",
              fontSize: "23px",
              color: "rgba(241,237,228,0.78)",
            }}
          >
            <span>{when}</span>
            <span style={{ color: "#ff5c35" }}>·</span>
            <span>{venue}</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "5px",
              fontSize: "16px",
              letterSpacing: "1.5px",
              color: "rgba(241,237,228,0.5)",
            }}
          >
            <span>REFUNDABLE DEPOSIT · ON-CHAIN ATTENDANCE</span>
            <span>NEAR TESTNET · NO REAL FUNDS</span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "16px",
              letterSpacing: "1.5px",
              color: "rgba(241,237,228,0.5)",
            }}
          >
            gatherbond.vercel.app
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
