import { ImageResponse } from "next/og";

export const alt = "Artificial Banking Incorporated — financial infrastructure for autonomous AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default Open Graph / Twitter share image for the public site. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(145deg, #0a0a0c 0%, #15151a 48%, #1a2438 100%)",
          color: "#f4f4f6",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 28,
            letterSpacing: "-0.02em",
            fontWeight: 600,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "#f4f4f6",
              color: "#0a0a0c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            AB
          </div>
          Artificial Banking Incorporated
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
          <div
            style={{
              fontSize: 64,
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              fontWeight: 650,
            }}
          >
            Let AI agents pay — without losing control.
          </div>
          <div style={{ fontSize: 28, lineHeight: 1.35, color: "#c4c4cc", maxWidth: 820 }}>
            Policy-gated wallets, human approvals, and an auditable ledger between agents and money.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 22, color: "#9a9aa3", letterSpacing: "0.02em" }}>
          artificial-banking-inc-web.vercel.app
        </div>
      </div>
    ),
    { ...size },
  );
}
