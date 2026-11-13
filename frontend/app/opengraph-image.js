import { ImageResponse } from "next/og";

export const alt =
  "GatherBond — refundable commitments for real-world gatherings on NEAR Testnet";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0e100e",
          color: "#f1ede4",
          padding: "64px",
          position: "relative",
          overflow: "hidden",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: "720px",
            height: "720px",
            borderRadius: "50%",
            border: "2px solid rgba(215,255,95,0.35)",
            top: "-250px",
            right: "-180px",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: "480px",
            height: "480px",
            borderRadius: "50%",
            border: "1px dashed rgba(241,237,228,0.3)",
            bottom: "-180px",
            left: "-120px",
            display: "flex",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "54px",
                height: "54px",
                borderRadius: "14px",
                background: "#d7ff5f",
                color: "#0e100e",
                fontSize: "24px",
                fontWeight: 700,
              }}
            >
              GB
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "22px",
                letterSpacing: "3px",
                color: "#d7ff5f",
              }}
            >
              GATHERBOND / NEAR TESTNET
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: "84px",
                fontWeight: 700,
                letterSpacing: "-4px",
                lineHeight: 1,
              }}
            >
              Make plans.
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "84px",
                fontWeight: 400,
                fontStyle: "italic",
                letterSpacing: "-4px",
                lineHeight: 1.1,
                color: "#d7ff5f",
              }}
            >
              Keep them.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: "40px",
            }}
          >
            <div
              style={{
                display: "flex",
                maxWidth: "720px",
                fontSize: "27px",
                lineHeight: 1.35,
                color: "rgba(241,237,228,0.82)",
              }}
            >
              Refundable commitments for real-world gatherings. Show up, get your bond
              back, and share the no-show pool.
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "6px",
                fontSize: "18px",
                letterSpacing: "2px",
                color: "rgba(241,237,228,0.55)",
              }}
            >
              <span>ESCROW, NOT PROMISES</span>
              <span>gatherbond.vercel.app</span>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
