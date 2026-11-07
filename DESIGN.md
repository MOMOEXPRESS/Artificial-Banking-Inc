---
name: ABI public identity and Assisted Shopping Studio
description: Original public ABI identity with the approved blue buyer and seller console.
colors:
  canvas: "#f4f5f7"
  ink: "#101115"
  surface-solid: "#ffffff"
  surface-2: "#f8f9fa"
  surface-3: "#eff1f3"
  fg: "#111216"
  muted: "#5f6470"
  accent: "#3873ae"
  accent-hover: "#2d5f92"
  studio-canvas: "#f5f7fa"
  studio-ink: "#182b43"
  studio-muted: "#53647a"
  studio-surface: "#ffffff"
  studio-surface-2: "#f5f7fb"
  studio-border: "#dce3ed"
  studio-border-strong: "#aab8cb"
  studio-accent: "#315dd8"
  studio-accent-hover: "#2448b2"
  studio-accent-soft: "#e8efff"
  studio-selected-text: "#234dbd"
  studio-rail: "#142236"
  studio-dark-canvas: "#101a29"
  studio-dark-surface: "#172438"
  studio-dark-ink: "#edf3ff"
  studio-dark-muted: "#b2c0d5"
  studio-dark-border: "#354760"
  studio-dark-ring: "#9bb8ff"
typography:
  body:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "14.5px"
  studio-headline:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "28px"
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  studio-title:
    fontSize: "22px"
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  studio-label:
    fontSize: "12px"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  studio-panel: "10px"
spacing:
  studio-sm: "8px"
  studio-md: "16px"
  studio-lg: "24px"
  studio-gutter: "28px"
components:
  studio-button-primary:
    backgroundColor: "{colors.studio-accent}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
  studio-button-primary-hover:
    backgroundColor: "{colors.studio-accent-hover}"
  studio-panel:
    backgroundColor: "{colors.studio-surface}"
    rounded: "{rounded.studio-panel}"
---
# Design System: ABI

## Overview

**Creative North Star: Assisted Shopping Studio (console only).**

The user pinned the original ABI design on 2026-11-07. Preserve the original hero, product frames, section rhythms, navigation, official wordmark, self-hosted IBM Plex fonts and public-facing chrome. The console chrome is superseded by the approved studio scope below. Marketplace additions inherit globals.css and design-system.css; marketplace.css must not override root colors, shared navigation, footer or theme tokens.

Homepage copy describes the agent marketplace. Live catalog, buyer/seller entry points and guides join the original sections. The earlier public-system baseline placed the console on its original overview with a marketplace entry; the approved console replacement below supersedes that console direction. the Marketplace view has explicit Demo and Live modes. Search, category filters and product grids follow the earlier marketplace mockup, adapted to the incumbent console dimensions and selected light/dark theme.

Demo sellers, ratings, stock and photos are fictional and visibly labeled. Scenarios simulate shortlist, quote, owner approval, digital delivery, physical escrow confirmation and review. Demo code never calls inventory, wallet or settlement APIs. Live mode retains the durable backend workflows. Product links open live mode directly.

Source authority: original base commit 27035954bb52ac6f5f1d0dbd91b86740bd9e537a, globals.css, design-system.css, marketing-shell.tsx, brand.tsx and marketplace components. The generated product contact sheet is demonstration imagery, not live inventory. Public catalog empty states remain truthful. Physical checkout stays unavailable until real shipping and escrow providers are configured.


The user approved blue option 2, Assisted Shopping Studio, on 2026-11-07 and confirmed the entire buyer/seller console, prioritizing shopping and inventory. This is a scoped replacement of console visual authority; public and marketing pages retain the original specification above. Approval evidence: `.impeccable/mocks/console-redesign/02-assisted-shopping.webp` and its `.webp.json` sidecar. The source implementation, rather than generated screenshot facts, defines actual controls and behavior.

**Key Characteristics:** calm operational density, open comparison surfaces, navy navigation, restrained cobalt actions, inspectable demo progress and equally considered buyer/seller workspaces.

## Colors

Unprefixed frontmatter tokens retain the original public palette. `studio-*` tokens apply only inside `.studio-console`; never promote these console colors to public root tokens. The console pairs cool canvas and white surfaces with navy text, steel secondary text, cobalt actions and pale-blue selection. Status colors remain semantic. Dark mode is explicitly implemented under `[data-theme="dark"] .studio-console`; consult `console-studio.css` for the complete theme mapping. The rail remains deep navy.

## Typography

Retain self-hosted IBM Plex and the incumbent sans stack. Console headings use 28px/1.25, section headings 22px/1.3 and tertiary headings 17px/1.4. Product titles use 19px, product prices 18px, ordinary shopping controls 14px and quiet labels 12px. At 820px the shopping heading becomes 25px. Use fixed UI hierarchy and readable product details rather than oversized marketing typography.

## Layout

Desktop console uses a 76px icon rail and a shared horizontal header containing ABI, Buy/Sell, workspace tasks and retained account controls. Scroll content has 28px gutters and a 1600px maximum view. Shopping uses a 300px brief/progress column beside results, with two product columns and purchase review below. This intentionally adapts the comp's 340px brief and sticky review to source constraints: the implemented review is in normal flow.

Seller navigation exposes Inventory, Orders & activity, Payouts and Integrations. Inventory separates Products, Order items, Returns & disputes and Vendor identity. Opening the editor adds a 340px right column; existing payment offers remain a separate disclosure. Buyer navigation exposes Shopping, Orders, Assistant, Agents and Approvals. Do not invent routes from screenshot labels.

At 1150px gutters become 24px, the brief becomes 260px and the inventory editor moves below its table. At 820px the brief and results stack, rail navigation becomes a labeled drawer, the header splits into two rows and the brief form uses two columns. At 520px product cards, progress and editor fields become one column; category controls scroll horizontally. Preserve existing table scrolling and mobile navigation.

## Elevation & Depth

Console panels are flat white or dark-theme surfaces with thin dividers: cards, orders and onboarding explicitly have no shadow or backdrop blur. The available elevated token is `0 6px 24px #15294412`; do not apply it indiscriminately to working panels. Public depth remains governed by the original global styles.

## Shapes

Console controls use 6px corners; cards and order containers use 10px; product images and workspace task buttons use 7px; rail buttons use 8px. Thin borders and open column boundaries establish structure without nested decorative cards.

## Components

Primary marketplace actions use cobalt, white text, 10px 14px padding, 14px semibold type and a 42px minimum height. Product shortlist actions use an outlined cobalt treatment. Category filters and section tabs use neutral surfaces with pale-blue selected backgrounds and visible borders; preserve `aria-pressed` and `aria-current` semantics. Workspace navigation combines icon and label; desktop rail labels remain accessible when visually hidden.

Inputs use solid surfaces, strong borders and 6px corners. Interactive elements receive a 2px focus outline with a 3px offset. Buttons transition background and border over 150ms ease-out; rail transforms use 180ms ease-out; reduced motion disables these transitions. Disabled controls retain their disabled semantics and use 0.55 opacity.

Shopping brief, simulated progress, open product facts and purchase review form the signature composition. Progress is a local demonstration, not evidence of autonomous live purchasing. Inventory tables use 14px text, 12px headers and 16px 12px cell padding; selected rows use the accent-soft surface. Editor details stay progressively disclosed.

## Do's and Don'ts

- Do preserve the original public hero, sections, wordmark, fonts, navigation and theme authority.
- Do scope console overrides beneath `.studio-console` and retain both light and dark mappings.
- Do keep fictional sellers, photos, stock, reviews, progress and checkout visibly labeled as demo data. Demo code must not call payment or inventory APIs.
- Do preserve live backend facts and existing wallet, x402 and stablecoin settlement boundaries.
- Don't infer licenses, provider capabilities, production readiness, prices or live inventory from the generated comp.
- Don't treat the comp as a guarantee of physical checkout, fulfillment or cross-vendor escrow. Existing implementation and configured providers determine availability.

Documentation is extracted from source and the approved reference. No browser/runtime or visual certification is claimed; the launcher was unavailable during this handoff.
