---
name: ABI original design with marketplace resources
description: Preserve ABI’s original visual system and integrate agent commerce.
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
typography:
  body:
    fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "14.5px"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
---
# ABI design

The user pinned the original ABI design on 2026-11-07. Preserve the original hero, product frames, section rhythms, navigation, official wordmark, self-hosted IBM Plex fonts and console chrome. Marketplace additions inherit globals.css and design-system.css; marketplace.css must not override root colors, shared navigation, footer or theme tokens.

Homepage copy describes the agent marketplace. Live catalog, buyer/seller entry points and guides join the original sections. Console starts on its original overview with a marketplace entry; the Marketplace view has explicit Demo and Live modes. Search, category filters and product grids follow the earlier marketplace mockup, adapted to the incumbent console dimensions and selected light/dark theme.

Demo sellers, ratings, stock and photos are fictional and visibly labeled. Scenarios simulate shortlist, quote, owner approval, digital delivery, physical escrow confirmation and review. Demo code never calls inventory, wallet or settlement APIs. Live mode retains the durable backend workflows. Product links open live mode directly.

Source authority: original base commit 27035954bb52ac6f5f1d0dbd91b86740bd9e537a, globals.css, design-system.css, marketing-shell.tsx, brand.tsx and marketplace components. The generated product contact sheet is demonstration imagery, not live inventory. Public catalog empty states remain truthful. Physical checkout stays unavailable until real shipping and escrow providers are configured.
