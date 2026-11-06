/**
 * The console rail has two shapes: a collapsible column on desktop and a
 * slide-in drawer on phones. The breakpoint matches the `max-width: 820px`
 * drawer rules in globals.css.
 */
export const DRAWER_MAX_WIDTH_PX = 820;

/** True when the rail is the phone drawer (no collapsed state there). */
export function isDrawerViewport(win: Pick<Window, "matchMedia"> | undefined = globalThisWindow()) {
  if (!win || typeof win.matchMedia !== "function") return false;
  return win.matchMedia(`(max-width: ${DRAWER_MAX_WIDTH_PX}px)`).matches;
}

function globalThisWindow(): Pick<Window, "matchMedia"> | undefined {
  return typeof window === "undefined" ? undefined : window;
}
