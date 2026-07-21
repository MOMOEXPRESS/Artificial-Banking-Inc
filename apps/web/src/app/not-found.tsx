"use client";

import Link from "next/link";
import { ABWordmark } from "../lib/brand";
import { Icon } from "../lib/ui";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <div className="not-found-inner">
        <ABWordmark size={36} />
        <p className="not-found-code mono">404</p>
        <h1>This route is off the allowlist.</h1>
        <p className="muted">
          The page you wanted doesn&rsquo;t exist — or policy denied the hop. Pick a known destination.
        </p>
        <div className="not-found-actions">
          <Link className="btn-primary" href="/">
            Home <Icon name="arrowRight" size={14} />
          </Link>
          <Link className="btn-ghost" href="/console">
            Launch console
          </Link>
          <Link className="btn-ghost" href="/approvals">
            Mobile approvals
          </Link>
        </div>
      </div>
    </main>
  );
}
