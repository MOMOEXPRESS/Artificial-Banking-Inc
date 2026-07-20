"use client";

/**
 * Artificial Banking Incorporated brand marks.
 *
 * The logo is a hexagon vault plate carrying an AB monogram, with a vault dial
 * struck through the centre — the dial is the product thesis in one glyph:
 * money behind a mechanism, not money behind a promise.
 */

export function ABMark({
  size = 40,
  tone = "currentColor",
}: {
  size?: number;
  tone?: string;
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
      {/* Hexagon vault plate */}
      <path
        d="M100 8 178 53 178 147 100 192 22 147 22 53Z"
        stroke={tone}
        strokeWidth="13"
        strokeLinejoin="round"
      />
      {/* A — left upright and apex */}
      <path
        d="M56 148 V70 a22 22 0 0 1 22-22 h10"
        stroke={tone}
        strokeWidth="13"
        strokeLinecap="square"
      />
      <path d="M88 100 H62" stroke={tone} strokeWidth="12" strokeLinecap="square" />
      {/* B — spine and two bowls */}
      <path d="M100 48 V152" stroke={tone} strokeWidth="13" strokeLinecap="square" />
      <path
        d="M100 48 h22 a24 24 0 0 1 0 48 h-22"
        stroke={tone}
        strokeWidth="13"
        strokeLinecap="square"
      />
      <path
        d="M100 100 h26 a26 26 0 0 1 0 52 h-26"
        stroke={tone}
        strokeWidth="13"
        strokeLinecap="square"
      />
      {/* Locking bolts on the plate edge */}
      <rect x="150" y="78" width="15" height="15" fill={tone} />
      <rect x="150" y="108" width="15" height="15" fill={tone} />
      {/* Vault dial struck through the centre */}
      <circle cx="100" cy="100" r="34" stroke={tone} strokeWidth="9" fill="none" />
      <circle cx="100" cy="100" r="9" fill={tone} />
      <path
        d="M100 52 V70 M100 130 V148 M52 100 H70 M130 100 H148"
        stroke={tone}
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Full lockup: mark, name, and the rule-and-INCORPORATED strip beneath. */
export function ABLockup({ size = 92 }: { size?: number }) {
  return (
    <div className="lockup">
      <ABMark size={size} />
      <div className="lockup-name">ARTIFICIAL BANKING</div>
      <div className="lockup-sub">
        <span className="rule" />
        INCORPORATED
        <span className="rule" />
      </div>
    </div>
  );
}

/** Compact horizontal lockup for navigation bars. */
export function ABWordmark({ size = 30 }: { size?: number }) {
  return (
    <div className="wordmark">
      <ABMark size={size} />
      <div>
        <div className="wordmark-name">ARTIFICIAL BANKING</div>
        <div className="wordmark-sub">INCORPORATED</div>
      </div>
    </div>
  );
}
