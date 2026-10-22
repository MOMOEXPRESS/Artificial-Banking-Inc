"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ABWordmark } from "../lib/brand";
import { Icon } from "../lib/ui";

/** App-level error UI matching the marketing / 404 visual language. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="not-found-page">
      <div className="not-found-inner">
        <ABWordmark size={36} />
        <p className="not-found-code mono">Error</p>
        <h1>Something went wrong on this page.</h1>
        <p className="muted">
          The request hit an unexpected fault. Retry the page, or head back to a known route.
          {error.digest ? (
            <>
              {" "}
              <span className="mono">Digest {error.digest}</span>
            </>
          ) : null}
        </p>
        <div className="not-found-actions">
          <button type="button" className="btn-primary" onClick={() => reset()}>
            Try again <Icon name="arrowRight" size={14} />
          </button>
          <Link className="btn-ghost" href="/">
            Home
          </Link>
          <Link className="btn-ghost" href="/console">
            Launch console
          </Link>
        </div>
      </div>
    </main>
  );
}
