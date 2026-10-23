"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Never render stack traces — Next already
 * withholds them in production; we keep the UI honest either way.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Surface the failure in the browser console / Vercel logs so a crash can be
  // diagnosed without a stack trace in the UI.
  useEffect(() => {
    console.error("[abi.console] error boundary:", error?.message ?? error, error?.digest ?? "");
  }, [error]);
  return (
    <main
      style={{
        minHeight: "60vh",
        display: "grid",
        placeContent: "center",
        gap: "1rem",
        padding: "2rem",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Something went wrong</h1>
      <p style={{ margin: 0, opacity: 0.8, maxWidth: "36rem" }}>
        The console hit an unexpected error. Your funds and API keys were not shown here.
        {error.digest ? ` Reference: ${error.digest}` : null}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          width: "fit-content",
          padding: "0.6rem 1rem",
          borderRadius: "0.5rem",
          border: "1px solid #ccc",
          background: "#111",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </main>
  );
}
