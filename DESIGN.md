---
name: ABI minimalist marketplace
description: Neutral working surfaces and restrained blue actions across the ABI marketplace.
colors:
  canvas: "#fafafa"
  ink: "#252525"
  ink-secondary: "#444"
  ink-muted: "#626262"
  ink-faint: "#686868"
  surface: "#fff"
  surface-2: "#f2f2f2"
  surface-3: "#eaeaea"
  surface-hover: "#e5e5e5"
  border: "#dedede"
  border-soft: "#ececec"
  border-strong: "#aaa"
  accent: "#246bc4"
  accent-hover: "#1856a3"
  accent-soft: "#e9f1fc"
  checklist: "#f1f1f1"
  row: "#f0f0f0"
  allowance: "#f0f1f3"
  card: "#f3f3f3"
  control: "#ededed"
  control-hover: "#e0e0e0"
  field: "#eee"
  selected-dock: "#e8e8e8"
  footer: "#f4f4f4"
  success: "#276747"
  error-surface: "#fbeaea"
  error-text: "#992731"
  selection: "#d4e5ff"
  selection-text: "#182a47"
typography:
  display:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(42px, 5.3vw, 72px)"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  section:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  body:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.55
  label:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  note:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.6
rounded:
  check: "6px"
  nav: "7px"
  control: "8px"
  tabs: "9px"
  image: "10px"
  dock-item: "12px"
  empty: "13px"
  row: "14px"
  dock: "18px"
spacing:
  compact: "8px"
  row-gap: "12px"
  medium: "16px"
  row: "20px"
  large: "24px"
  section: "28px"
  wide: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
    height: "42px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  checklist-row:
    backgroundColor: "{colors.checklist}"
    rounded: "{rounded.row}"
    padding: "14px 18px"
  catalog-row:
    backgroundColor: "{colors.row}"
    rounded: "{rounded.row}"
    padding: "20px"
  category-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
---

# Design System: ABI minimalist marketplace

## Overview

**Creative North Star: "ABI minimalist marketplace"**

The approved o11-inspired direction uses a near-white field, quiet neutral rows, readable dark text and restrained blue actions. ABI keeps its wordmark and self-hosted IBM Plex family. The approved minimal-reference overview, catalog and billing studies plus .impeccable/briefs/minimal-marketplace.md define the chosen world; current source defines actual controls and values. Earlier navy-rail Assisted Shopping Studio and beige/green directions are superseded.

**Key Characteristics:**
- Flat tonal surfaces and thin dividers.
- Five clear destinations with advanced controls retained under More.
- Equal category prominence and visible buyer/seller entry points.
- Compact task hierarchy, inspectable balances and honest unavailable states.

## Colors

The frontmatter preserves the implemented CSS color strings. Primary blue serves actions, caret and focus; soft blue distinguishes key disclosure and informative states. Neutral canvas, row, field and divider tokens do the structural work. Muted and secondary ink remain readable; selected category controls pair dark ink with white lettering. Success and error colors communicate actual state.

**The Neutral Ground Rule.** Keep working surfaces neutral; reserve blue for actions and meaningful state.

## Typography

IBM Plex Sans is self-hosted through next/font/local (400, 500, 600, 700). The source stack uses --font-sans with IBM Plex Sans, Segoe UI, system-ui and sans-serif fallbacks. IBM Plex Mono is self-hosted at 400/500 for code and credentials, through the existing mono stack. Do not introduce remote font dependencies.

The frontmatter records the homepage display and console hierarchy. Console page headings inherit 1.25 line-height; section headings inherit 1.3. Body copy is limited to 72ch on minimal pages. Notes use the smaller, quieter role; numeric balances use tabular figures. At 760px page headings become 29px and the homepage display becomes 48px. Billing balances use 40px/1.15 on desktop and 29px on mobile; overview balance figures use 28px then 22px.

## Layout

Desktop uses a single content column with a horizontal workspace header, not a rail. Header height is 76px with a 1180px alignment reference. Console view maximum is 1120px; minimal task pages are 1000px. Scroll padding is 20px 40px 80px. Homepage content is 1120px with 24px side padding; its hero uses 1.25fr/1fr columns and a 64px gap. Homepage categories form three equal columns.

Buyer destinations are Overview, Catalog, Connect, Billing and Settings. Seller equivalents are Inventory, Orders, Connect, Payouts and Settings. More remains available for both roles. At 900px the navigation spacing tightens; at 760px desktop destinations hide and a floating five-destination dock appears. The dock is at most 440px wide (94% viewport), with safe-area-aware bottom placement and 58px minimum item heights. Header becomes 62px, console padding becomes 12px 20px 120px, forms/allowances stack and homepage sections become one column. Desktop navigation may scroll horizontally above 760px.

Overview-specific compact rows use 66px minimum height and 14px 18px padding, 28px section margins, and a 36px/28px workspace strip margin. Preserve setup, balance and allowance reading order. Catalog uses horizontal result rows with 84px images (64px mobile), not a decorative tile wall. Billing retains two separate currency columns; activity rows reflow on mobile.

## Elevation & Depth

Flat tonal separation is the default. Working cards, catalog rows and purchase review have no shadow. Selected segmented controls use `0 1px 4px #0002`. Mobile dock and cookie notice use `0 6px 24px #0001`. There is no glass or backdrop blur in the current navigation. Do not reuse superseded blue-studio elevation values.

## Shapes

Quiet rounded rectangles organize rows, controls and disclosure. The frontmatter records actual radii: modest controls, softer rows and a larger mobile-dock silhouette. Dividers are thin and neutral. Product imagery remains square and clipped; repeated outline icons support labels without decorative effects.

## Components

### Buttons

Primary actions use blue with white text; secondary actions use neutral control surfaces. Minimal-page buttons have a 42px minimum height, 9px 16px padding and medium-weight labels. Blue hover uses accent-hover; neutral hover uses control-hover. Disabled minimal-page buttons use 0.48 opacity and a not-allowed cursor. Focus is a 2px blue outline offset by 3px. Existing console button transitions use 150ms ease-out for background/border; reduced motion disables transitions.

### Inputs / Fields

Neutral filled fields use transparent borders, 8px corners and a 42px minimum height. Minimal-page inputs/selects use 10px 12px padding and 15px type. Search uses surface-3, 10px corners, a 56px minimum height and 16px text. Blue caret and visible focus remain. Checkboxes retain native semantics and blue accent.

### Chips

Category controls remain equal in width and prominence. Unselected labels use secondary ink on neutral controls; selected labels use white on dark ink. Preserve aria-pressed and the explicit important-text override required by inherited marketplace styles. Secondary filters remain in a disclosure.

### Cards / Containers

Checklist and allowance rows use quiet gray fills and 14px corners. Allowances use 20px padding in Overview; catalog rows use 20px on desktop and 16px on mobile. Key disclosure uses soft blue; error surfaces use error text on error-surface. Do not equate an unavailable affordance with a configured service.

### Navigation

Desktop header combines ABI, five text destinations, a buyer/seller entry and More. Active desktop destinations have a neutral fill and dark text; the mobile dock pairs outline icons and labels with a neutral selected state. Preserve aria-current. More retains buyer Assistant, Agents & allowances, USDC treasury, Payments & approvals, Activity, Agent work, Policies, Ledger, API playground and Webhooks; seller More retains Overview, Directory, Versions, Sandbox, Analytics, Activity, Access policies, Webhooks and Developers.

### Currency and credential disclosures

Billing presents USD credits and USDC settlement separately. Funding and saved-card/auto-top-up actions remain disabled until server readiness, including Stripe setup and a defined usage/refund policy. Connect owns scoped-key administration and one-time secret delivery. No USD consumption or fiat-to-USDC conversion is implemented; the existing settlement deployment remains Base Sepolia.

## Do's and Don'ts

### Do:
- Do use the neutral palette and restrained blue actions across .studio-console and .landing.
- Do keep all three category labels legible and equally visible.
- Do preserve both roles’ advanced destinations under More and native keyboard/focus semantics.
- Do distinguish simulated demo facts, actual listing data, USD credits and Base Sepolia USDC.

### Don't:
- Don’t restore the superseded navy rail or blue-tinted working canvas.
- Don’t expose or persist credentials as decorative billing content.
- Don’t infer live card payments, physical fulfillment or production readiness from the approved studies or synthetic captures.

Source extraction: apps/web/src/app/minimal-workspace.css, app/layout.tsx, app/page.tsx, lib/minimal-workspace.tsx and lib/studio-nav.tsx, with inherited typography/state rules from globals.css and console-studio.css. This document records source and approved direction; it does not certify rendering. No launcher/detector, comp-spec, automated diff or build-state provenance is available. Final screenshots after the reviewer fixes are pending.
