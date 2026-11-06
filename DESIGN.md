---
name: ABI marketplace
description: Beige-dominant commerce with restrained forest-green actions.
colors:
  canvas: "#f4ede2"
  ink: "#292820"
  ink-secondary: "#514d43"
  ink-muted: "#625e52"
  ink-faint: "#746d5e"
  surface: "#fffdf8"
  surface-solid: "#fffdf8"
  surface-2: "#f7f1e8"
  surface-3: "#e9e0d2"
  surface-hover: "#e1d6c5"
  fg: "#292820"
  fg-secondary: "#514d43"
  fg-muted: "#625e52"
  fg-faint: "#746d5e"
  border: "#d8cebe"
  border-soft: "#e7dfd2"
  border-strong: "#b6a991"
  border-canvas: "#d8cebe"
  accent: "#185c43"
  accent-hover: "#10432f"
  accent-soft: "#e0eadd"
  ring: "#185c43"
  seg-active-bg: "#185c43"
  seg-active-fg: "#fffdf8"
  footer-forest: "#123b30"
  selection: "#d3dfbd"
typography:
  display:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(30px, 3.2vw, 48px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(24px, 2.2vw, 32px)"
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "14.5px"
    letterSpacing: "-0.005em"
  label:
    fontSize: "14px"
rounded:
  sm: "8px"
  md: "12px"
spacing:
  space-0: "0px"
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
  space-8: "32px"
  space-10: "40px"
  space-12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  input:
    backgroundColor: "{colors.surface-solid}"
    textColor: "{colors.fg}"
    rounded: "{rounded.sm}"
    padding: "12px"
  image-panel:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.md}"
  empty-state:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "40px 24px"
---
# Design System: ABI marketplace

## Overview

**Creative North Star: ABI’s beige marketplace.** The approved identity pairs a warm, dominant beige canvas with restrained forest-green actions. Familiar commerce patterns follow Shopify storefront clarity, Amazon search usefulness and Etsy discovery; eBay is an explicit anti-reference. Buyer and seller surfaces share the same visual language.

**Key Characteristics:**
- Warm tonal surfaces and direct, legible typography.
- Image-led listings with clear metadata and visible seller entry points.
- Flat controls with softly curved corners and deliberate focus states.

This document replaces the provisional seed with source-confirmed documentation. Evidence: `apps/web/src/app/marketplace.css`, its import order and self-hosted fonts in `layout.tsx`, inherited primitives in `globals.css` and `design-system.css`, homepage `page.tsx`, `lib/marketing-shell.tsx`, and `lib/marketplace-*.tsx`. The source-only reviewer reports prior P1 findings resolved. No rendered screenshots, computed-style sampling, or live visual certification were available; responsive appearance, full-route cascade interactions and visual release readiness remain unverified. These limits do not make the extracted source values provisional.

## Colors

### Primary
Forest action colors identify purchase preparation, search and seller actions. The deeper footer forest anchors public chrome. Hover and focus have explicit source colors.

### Neutral
Canvas, surface, surface-2 and surface-3 form the beige material hierarchy. Ink and its secondary, muted and faint variants support reading; border strengths separate fields and content. Repeated foreground/surface aliases reflect actual shared-console compatibility tokens.

**The Beige Identity Rule.** Keep beige dominant and green restrained, as the user approved. The former provisional lime accent is not an implemented marketplace token and is not part of this specification.

The root layout defaults to light. An explicit dark-theme override exists in marketplace.css; its exact values remain there as the implementation authority. Do not infer a generated tonal ramp or automatic theme parity from the light palette documented above.

## Typography

IBM Plex Sans is self-hosted in normal weights 400, 500, 600 and 700 with swap loading. It carries display and UI text with system fallbacks. Existing IBM Plex Mono remains self-hosted for inherited technical console content; it is not a decorative marketplace display face.

Display and headline roles above describe homepage headings. The display becomes 36px below 650px. Product titles use 19px/1.3, becoming 17px below 650px. Marketplace paragraphs use 1.6 line height and a 72ch maximum where scoped. Form labels use the label role; product metadata and fine print use 13px. The body role records the inherited document base, not a universal paragraph override. Prices and tables use tabular numerals.

## Layout

The public content container has a 1440px maximum, 32px top padding, fluid horizontal padding from 20px to 64px, and 64px bottom padding. Workspace content caps at 1300px. Source spacing primitives are listed above; 64px is also an observed section/container measurement, not an added scale variable.

Product grids use four equal columns and 24px gaps, changing to two columns at 1000px and 16px gaps at 650px. The hero uses a 1.5:1 split and 48px gap, then equal columns at 1000px and one column at 650px. Details and explanatory sections also stack at 650px. Two-column forms become one column; wide tables retain horizontal scrolling.

Header search occupies the middle desktop column. At 900px it moves to a second full-width row. Category navigation scrolls horizontally. These are source-defined responsive rules; rendered verification is pending.

## Elevation & Depth

Tonal layering and thin dividers carry the marketplace. Public navigation explicitly disables backdrop blur. Glass shadow is disabled; the shared elevated token remains available for inherited surfaces and is recorded in the sidecar. Product cards themselves have no marketplace shadow declaration. Do not infer a global shadow ban for legacy console components.

## Shapes

Controls use the small rounded token; product image panels, brief panels, empty states and order containers use the medium token. Product imagery uses a clipped 4:3 panel with cover fitting. Shared console radius variables outside the marketplace overrides remain in design-system.css; this document does not rename or replace them.

## Components

### Buttons
Primary controls are solid action green with warm-white text, minimum height 44px and semibold labels. Hover changes the background; disabled buttons use half opacity and a not-allowed cursor. The 150ms ease-out background transition is removed for reduced motion. Within marketplace content, keyboard focus uses a 3px ring with a 3px offset.

### Inputs / Fields
Solid warm surfaces, strong 1px borders, inherited type and small corners. Fields have a 44px minimum height, constrained width and accent-colored caret. Search fields in shared header chrome have their own 10px 12px padding. Marketplace form focus follows the explicit ring treatment.

### Cards / Containers
Product cards are open image-and-copy compositions, not enclosing nested cards. Their image panel is followed by 16px vertical copy padding. Empty states and seller bands use solid warm surfaces; order and review panels use surface-2. Stock, seller, category and product kind remain readable metadata.

### Navigation
Public chrome combines wordmark, labeled search, account actions and a category row with a seller entry. Desktop primary links collapse in favor of category navigation; mobile menu state includes Escape handling. The skip link becomes visible on focus. Do not imply every inherited navigation control has the marketplace-scoped focus selector.

## Do's and Don'ts

### Do:
- **Do** preserve dominant beige, restrained green and the existing ABI identity.
- **Do** keep buyer and seller journeys equally considered.
- **Do** retain labeled fields, visible marketplace focus, reduced-motion handling and truthful empty states.
- **Do** distinguish physical product photography from digital covers and preserve accurate product-kind labels.

### Don't:
- **Don't** introduce eBay styling, financial-chart imagery or decorative monospace into the marketplace identity.
- **Don't** invent inventory, endorsements or production availability to fill a layout.
- **Don't** treat source inspection as rendered accessibility or visual-release certification.
