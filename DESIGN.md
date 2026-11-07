---
name: ABI original vault and o11 hybrid
description: Original ABI vault identity with Inter typography, opaque neutral content and selective glass chrome.
colors:
  canvas: "#fafafa"
  ink: "#262626"
  ink-secondary: "#525252"
  surface: "#f4f4f4"
  field: "#e5e5e5"
  accent: "#2878c9"
  accent-hover: "#1d67b1"
  border: "#e5e5e5"
  checklist: "#f1f1f1"
  nav-glass: "#fafafad9"
  dock-glass: "#fafafaa6"
  menu-glass: "#fafafae6"
typography:
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  section:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 500
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
rounded:
  control: "6px"
  field: "7px"
  row: "12px"
  dialog: "16px"
  dock: "17px"
spacing:
  compact: "8px"
  row-gap: "12px"
  medium: "16px"
  row: "20px"
  large: "24px"
  overview-gap: "30px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#fff"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "36px"
    typography: "{typography.label}"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    height: "38px"
  content-row:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.row}"
---

# Design System: ABI original vault and o11 hybrid

## Authority and identity

The current direction combines the original ABI console and VaultBankCard with the supplied o11 reference typography, neutral forms, placement and layering. Authority is .impeccable/briefs/abi-o11-hybrid.md and the approved overview-study.png in .impeccable/mocks/abi-o11-hybrid. The study is illustrative; use the actual ABI mark, vault component and factual account data. It supersedes the earlier minimal-reference composition and IBM Plex body typography, navy-rail studio and beige/green directions. The public-home structure remains, with shared typography and chrome adapted.

## Typography and color

Official Inter variable is self-hosted through next/font/local at weights 100–900, with SIL OFL in apps/web/src/app/fonts/OFL-Inter.txt. Body and controls use 400; headings use 500. The stack is --font-sans, Inter, system-ui, sans-serif. IBM Plex Mono remains self-hosted at 400/500 for code and credentials. No remote font dependency is needed.

Console body is 14px/1.45; page headings are 28px/1.2 with -0.025em tracking, sections 21px, subheadings 16px and controls generally 13px. Mobile page headings become 24px and sections 19px. Dialog fields use 16px on mobile. Paragraphs use 1.55 line-height. The frontmatter records the principal current roles; inherited components may retain more specific source values.

Use #fafafa ground, #262626 ink, #525252 secondary text, opaque #f4f4f4 content and #e5e5e5 fields. Checklist and workspace rows retain #f1f1f1. Blue #2878c9 marks primary actions, focus and caret; #1d67b1 is the accent-hover token. Neutral surfaces and understated separators provide structure. Category selection uses a dark underline and dark text on the same neutral background.

## Layout and materials

The desktop workspace has a 72px horizontal header and a centered floating five-destination dock. Content views reach 1120px; minimal task pages reach 1080px. At 760px, desktop links hide, the header is 62px, content has 20px side padding and 112px bottom clearance, and the dock fits within a 420px maximum and safe-area-aware bottom placement. The dock is also present on desktop. Preserve keyboard focus, aria-current, native form semantics, loading/error/empty states and reduced motion.

Overview uses two equal desktop columns with a 30px gap: setup checklist on the left, workspace row and original card on the right. It stacks at 760px. Checklist rows are at least 84px on desktop and 66px on mobile. Agent rows follow beneath. The original charcoal/silver ABI card retains its metallic gradients, inset highlight, subtle shadow and blur; it represents the vault, not a card-network product.

Content, provider rows, seller forms and spending controls are opaque. Glass is reserved for navigation, account menus and the vault card. Header glass uses #fafafad9 with 24px blur; the dock uses #fafafaa6 with 28px blur, white inset highlights and a subtle shadow. Account menus use #fafafae6 and 28px blur. Reduced-transparency preferences make the designated navigation surfaces opaque. Dialogs use opaque #fafafa, bounded viewport height, internal scrolling and an overlay; they are not glass content cards.

## Navigation and workspaces

Buyer navigation is Overview, Marketplace, Connect, Billing and Settings. Seller navigation is Overview, Inventory, Connect, Payouts and Settings. Both retain a visible role-switch entry. There is no More menu or standalone ledger/webhook destination. Existing financial, settlement and audit backend code remains internally available. The interface is pinned light; the nonfunctional Theme menu has been removed.

Marketplace provides provider/product segmentation, search, category tabs and understated provider/result rows from published inventory. Tools & APIs, Software and Physical goods have equal prominence. There is no Demo/Live selector; the Purchases tab owns order content. Catalog result images are 52px squares in the current console, and provider rows use opaque #f4f4f4 with 12px corners. Never substitute invented vendors or study balances for actual data.

Connect centers setup and scoped-key administration. Creation opens a dialog; secrets have one-time delivery, replacement and revocation retain existing controls, and secrets must not persist in localStorage. Fields use neutral fills, 7px corners and visible blue focus. Principal console buttons use 6px corners and a 36px minimum height; dialog actions use at least 38px. Disabled controls remain visibly unavailable.

Billing separates Overview and Spending limits. Limits use UTC calendar day/week/month windows, a shared workspace cap or a total window expiring within 90 days, per-purchase controls, approval rules and recurring-purchase opt-out. Editing a total window preserves its original start time. Existing daily limits and agent budgets remain in force. Connected-service write actions are explicitly unavailable rather than enabled decorative switches.

Seller overview, inventory, connection, payout and settings surfaces share the same typography and opaque materials. Seller authentication ends a session only on a definitive 401. Network/429/5xx and malformed-response errors retain the session and provide recovery. Buyer/seller identity realms, verification and MFA remain separate and enforced.

## Financial truth and evidence

USD card credits and Base Sepolia USDC settlement remain distinct. Card funding, saved-card and auto-top-up actions stay gated until operator configuration and usage/refund policy are ready. Checkout redirects do not establish credits; no USD consumption or fiat-to-USDC conversion is implemented. The interface and study do not prove live funding, purchases, shipping or fulfillment.

This document records current source and approved direction. It does not certify rendering or deployment. Hybrid desktop/mobile captures and independent finish review must be evaluated through their own artifacts; older minimal-reference reviews apply only to that prior revision. Synthetic fixtures demonstrate bounded presentation and behavior.

Sources: apps/web/src/app/reference-console.css (loaded after minimal-workspace.css), app/layout.tsx, lib/studio-nav.tsx, lib/minimal-workspace.tsx, lib/spending-limits.tsx, lib/seller-session.ts and the original VaultBankCard component. Inherited layout and state rules remain in minimal-workspace.css, globals.css and console-studio.css.
