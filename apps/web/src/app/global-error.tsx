"use client";

/**
 * Root error boundary (replaces the root layout when it fails).
 * Keep copy generic — no env, no stack, no secrets.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeContent: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "#0b0b0c",
          color: "#f5f5f5",
        }}
      >
        <main style={{ display: "grid", gap: "1rem", padding: "2rem", maxWidth: "36rem" }}>
          <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Console unavailable</h1>
          <p style={{ margin: 0, opacity: 0.8 }}>
            A top-level error stopped the page from rendering.
            {error.digest ? ` Reference: ${error.digest}` : null}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              width: "fit-content",
              padding: "0.6rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid #333",
              background: "#fff",
              color: "#111",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
