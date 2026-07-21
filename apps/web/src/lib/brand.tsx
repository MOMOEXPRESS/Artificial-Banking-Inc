"use client";

/**
 * Artificial Banking Incorporated brand system.
 *
 * Three cuts from the official lockup templates:
 *   ABMark     — hexagonal AB vault emblem (standalone)
 *   ABLockup   — stacked mark + ARTIFICIAL BANKING / INCORPORATED
 *   ABAppIcon  — mark on a black squircle (favicon, console rail)
 *   ABWordmark — horizontal mark + name (nav, footer)
 */

type Tone = string;

/** Hexagonal AB vault emblem. */
export function ABMark({
  size = 40,
  tone = "currentColor",
}: {
  size?: number;
  tone?: Tone;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M100 8 178 53 178 147 100 192 22 147 22 53Z"
        stroke={tone}
        strokeWidth="14"
        strokeLinejoin="round"
      />
      {/* A — left upright follows the hex wall */}
      <path
        d="M52 152 V72 L88 38 H112"
        stroke={tone}
        strokeWidth="14"
        strokeLinecap="square"
        strokeLinejoin="miter"
        fill="none"
      />
      <path d="M86 104 H58" stroke={tone} strokeWidth="13" strokeLinecap="square" />
      {/* Shared spine + B bowls */}
      <path d="M100 40 V160" stroke={tone} strokeWidth="14" strokeLinecap="square" />
      <path
        d="M100 40 h24 a26 26 0 0 1 0 52 H100"
        stroke={tone}
        strokeWidth="14"
        fill="none"
        strokeLinecap="square"
      />
      <path
        d="M100 92 h28 a28 28 0 0 1 0 56 H100"
        stroke={tone}
        strokeWidth="14"
        fill="none"
        strokeLinecap="square"
      />
      {/* Three vault hinges */}
      <rect x="154" y="72" width="16" height="14" fill={tone} />
      <rect x="154" y="96" width="16" height="14" fill={tone} />
      <rect x="154" y="120" width="16" height="14" fill={tone} />
      {/* Vault dial */}
      <circle cx="100" cy="100" r="36" stroke={tone} strokeWidth="9" fill="none" />
      <circle cx="100" cy="100" r="22" stroke={tone} strokeWidth="5" fill="none" />
      <circle cx="100" cy="100" r="8" fill={tone} />
      <path
        d="M100 48 V66 M100 134 V152 M48 100 H66 M134 100 H152"
        stroke={tone}
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** App icon: white mark on black squircle — rail, favicon, avatar. */
export function ABAppIcon({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="200" height="200" rx="44" fill="#000" />
      <g transform="translate(28 28) scale(0.72)">
        <path
          d="M100 8 178 53 178 147 100 192 22 147 22 53Z"
          stroke="#fff"
          strokeWidth="14"
          strokeLinejoin="round"
        />
        <path
          d="M52 152 V72 L88 38 H112"
          stroke="#fff"
          strokeWidth="14"
          strokeLinecap="square"
          strokeLinejoin="miter"
          fill="none"
        />
        <path d="M86 104 H58" stroke="#fff" strokeWidth="13" strokeLinecap="square" />
        <path d="M100 40 V160" stroke="#fff" strokeWidth="14" strokeLinecap="square" />
        <path
          d="M100 40 h24 a26 26 0 0 1 0 52 H100"
          stroke="#fff"
          strokeWidth="14"
          fill="none"
          strokeLinecap="square"
        />
        <path
          d="M100 92 h28 a28 28 0 0 1 0 56 H100"
          stroke="#fff"
          strokeWidth="14"
          fill="none"
          strokeLinecap="square"
        />
        <rect x="154" y="72" width="16" height="14" fill="#fff" />
        <rect x="154" y="96" width="16" height="14" fill="#fff" />
        <rect x="154" y="120" width="16" height="14" fill="#fff" />
        <circle cx="100" cy="100" r="36" stroke="#fff" strokeWidth="9" fill="none" />
        <circle cx="100" cy="100" r="22" stroke="#fff" strokeWidth="5" fill="none" />
        <circle cx="100" cy="100" r="8" fill="#fff" />
        <path
          d="M100 48 V66 M100 134 V152 M48 100 H66 M134 100 H152"
          stroke="#fff"
          strokeWidth="8"
          strokeLinecap="round"
        />
      </g>
    </svg>
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
  return (
    <div className="lockup" style={{ color: tone }}>
      <ABMark size={size} tone={tone} />
      <div className="lockup-name">ARTIFICIAL BANKING</div>
      <div className="lockup-sub">
        <span className="rule" />
        INCORPORATED
        <span className="rule" />
      </div>
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
  return (
    <div className="wordmark" style={{ color: tone }}>
      <ABMark size={size} tone={tone} />
      <div>
        <div className="wordmark-name">ARTIFICIAL BANKING</div>
        <div className="wordmark-sub">INCORPORATED</div>
      </div>
    </div>
  );
}
