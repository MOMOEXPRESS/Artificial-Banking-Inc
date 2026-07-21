"use client";

/**
 * Artificial Banking Incorporated brand system.
 *
 * Uses the official lockup cuts from /public (not a redrawn SVG):
 *   ABMark     — hexagonal AB vault emblem
 *   ABLockup   — stacked mark + ARTIFICIAL BANKING / INCORPORATED
 *   ABAppIcon  — mark on a black squircle (favicon, console rail)
 *   ABWordmark — horizontal mark + name (nav, footer)
 */

type Tone = string;

function isLightTone(tone: Tone) {
  const t = tone.trim().toLowerCase();
  return t === "#fff" || t === "#ffffff" || t === "white" || t === "currentcolor";
}

/** Hexagonal AB vault emblem — official cut. */
export function ABMark({
  size = 40,
  tone = "currentColor",
}: {
  size?: number;
  tone?: Tone;
}) {
  const light = isLightTone(tone) && tone !== "currentColor";
  // currentColor on dark UI → light mark; on light marketing → dark mark via CSS filter fallback
  const src = light ? "/abi-mark-light.png" : "/abi-mark.png";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="brand-mark"
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
      draggable={false}
    />
  );
}

/** App icon: white mark on black squircle — rail, favicon, avatar. */
export function ABAppIcon({ size = 40 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/abi-app-icon.png"
      alt=""
      width={size}
      height={size}
      className="brand-app-icon"
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "block",
        borderRadius: Math.round(size * 0.22),
      }}
      draggable={false}
    />
  );
}

/** Full stacked lockup for login, CTA bands, splash. */
export function ABLockup({
  size = 92,
  tone = "currentColor",
}: {
  size?: number;
  tone?: Tone;
}) {
  const light = isLightTone(tone) && tone !== "currentColor";
  const src = light ? "/abi-lockup-light.png" : "/abi-lockup.png";
  // Official lockup aspect ≈ 1024×765
  const height = Math.round(size * (765 / 1024));
  return (
    <div className="lockup" style={{ color: tone, width: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Artificial Banking Incorporated"
        width={size}
        height={height}
        style={{ width: size, height: "auto", display: "block" }}
        draggable={false}
      />
    </div>
  );
}

/** Compact horizontal lockup for navigation bars and footers. */
export function ABWordmark({
  size = 30,
  tone = "currentColor",
}: {
  size?: number;
  tone?: Tone;
}) {
  const light = isLightTone(tone) && tone !== "currentColor";
  const src = light ? "/abi-mark-light.png" : "/abi-mark.png";
  return (
    <div className="wordmark" style={{ color: tone }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: "contain", display: "block", flexShrink: 0 }}
        draggable={false}
      />
      <div>
        <div className="wordmark-name">ARTIFICIAL BANKING</div>
        <div className="wordmark-sub">INCORPORATED</div>
      </div>
    </div>
  );
}
