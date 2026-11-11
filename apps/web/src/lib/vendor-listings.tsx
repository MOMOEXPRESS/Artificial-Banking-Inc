"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { IntegratedListing } from "./vendor-directory-data";

/** How long each listing stays in place before the carousel moves on. */
export const CAROUSEL_INTERVAL_MS = 3200;
/** Clones appended after the last card so the loop never shows a gap. */
const CLONES = 3;

function ListingCard({
  listing,
  onOpen,
  hidden = false,
}: {
  listing: IntegratedListing;
  onOpen?: (slug: string) => void;
  hidden?: boolean;
}) {
  const { provider, action } = listing;
  const body: ReactNode = (
    <>
      <span className="vendor-listing-provider">
        <span className="vendor-logo is-small" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static vendor mark */}
          <img
            src={provider.logo.src}
            alt=""
            width={provider.logo.width}
            height={provider.logo.height}
          />
        </span>
        <span>{provider.name}</span>
        <span className="vendor-listing-pill">{provider.status.label}</span>
      </span>
      <strong className="vendor-listing-title">{action.listingTitle}</strong>
      <span className="vendor-listing-desc">{action.description}</span>
      <span className="vendor-listing-price">
        <strong>{action.unitPrice}</strong>
        <small>{action.unitNote ? `${action.unitNote} · vendor price` : "Vendor price"}</small>
      </span>
    </>
  );
  const label = `${action.listingTitle} from ${provider.name}, ${action.unitPrice}, ${provider.status.label.toLowerCase()}`;
  const focus = hidden ? -1 : undefined;
  return onOpen ? (
    <button
      type="button"
      className="vendor-listing"
      onClick={() => onOpen(provider.slug)}
      aria-label={label}
      tabIndex={focus}
    >
      {body}
    </button>
  ) : (
    <Link
      className="vendor-listing"
      href={`/providers/${provider.slug}#${action.id}`}
      aria-label={label}
      tabIndex={focus}
    >
      {body}
    </Link>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const change = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return reduced;
}

/**
 * Integrated vendor listings, three to a row on desktop, moving one listing at
 * a time on their own. Pauses on hover, keyboard focus and a hidden tab, and
 * stays still for people who ask for reduced motion.
 */
export function ListingCarousel({
  listings,
  onOpen,
}: {
  listings: IntegratedListing[];
  onOpen?: (slug: string) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const count = listings.length;
  const moves = count > CLONES;
  const running = moves && !reduced && !hovered && !focused && visible;
  const keyOf = listings.map((l) => `${l.provider.slug}/${l.action.id}`).join("|");
  const snapping = useRef(false);

  useEffect(() => {
    setAnimate(false);
    setIndex(0);
  }, [keyOf]);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (snapping.current) return;
      setAnimate(true);
      setIndex((i) => i + 1);
    }, CAROUSEL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running]);
  // Re-enable the slide after a snap back to the start.
  useEffect(() => {
    if (animate) return;
    const frame = window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        snapping.current = false;
        setAnimate(true);
      }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [animate]);

  if (count === 0) return null;
  const track = moves ? [...listings, ...listings.slice(0, CLONES)] : listings;
  const shown = (index % count) + 1;
  return (
    <div
      className="vendor-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Marketplace listings"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {moves && (
        <div className="vendor-carousel-controls">
          <span className="vendor-carousel-position" aria-live={running ? "off" : "polite"}>
            {shown} of {count}
          </span>
        </div>
      )}
      <div className="vendor-carousel-viewport">
        <ul
          className={`vendor-carousel-track${animate && !reduced ? " is-animated" : ""}`}
          style={{ ["--slide" as string]: index }}
          onTransitionEnd={(e) => {
            if (e.target !== e.currentTarget) return;
            if (index >= count) {
              snapping.current = true;
              setAnimate(false);
              setIndex(index - count);
            }
          }}
        >
          {track.map((listing, i) => {
            const clone = i >= count;
            return (
              <li
                key={`${listing.provider.slug}/${listing.action.id}${clone ? "-clone" : ""}`}
                aria-hidden={clone || undefined}
                aria-roledescription="slide"
              >
                <ListingCard listing={listing} onOpen={onOpen} hidden={clone} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** The same listing cards as a static grid, for the Tools & products view. */
export function ListingGrid({
  listings,
  onOpen,
}: {
  listings: IntegratedListing[];
  onOpen?: (slug: string) => void;
}) {
  if (listings.length === 0) return null;
  return (
    <ul className="vendor-listing-grid">
      {listings.map((listing) => (
        <li key={`${listing.provider.slug}/${listing.action.id}`}>
          <ListingCard listing={listing} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}
