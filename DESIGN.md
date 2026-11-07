---
name: ABI liquid wallet and o11 console
description: Actual ABI identity with clear liquid-glass wallet, Inter typography and opaque neutral working content.
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
  wallet-glass: "#ffffff52"
  wallet-ink: "#222832"
  wallet-token: "#ffffffb0"
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
  wallet: "22px"
spacing:
  compact: "8px"
  row-gap: "12px"
  medium: "16px"
  row: "20px"
  large: "24px"
  overview-gap: "30px"
  wallet-gap: "34px"
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
  wallet-card:
    backgroundColor: "{colors.wallet-glass}"
    textColor: "{colors.wallet-ink}"
    rounded: "{rounded.wallet}"
    padding: "27px 30px"
  content-row:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.row}"
---

# Design System: ABI liquid wallet and o11 console

## Authority and identity

The approved white/blue Inter console remains the shared world. The wallet authority is .impeccable/briefs/abi-liquid-wallet.md and the explicitly approved .impeccable/mocks/abi-wallet-refinement/wallet-liquid-glass.png with its approval JSON. wallet-mobile.png establishes stacking only; its smoked card is superseded by clear liquid glass. The prior o11 hybrid brief and overview study still govern shared console typography, chrome and opaque working materials. Generated figures are illustrative; use the actual ABI mark and factual API content. Public-home structure remains with shared typography/chrome adaptation. Earlier minimal-reference, navy-rail and beige/green directions remain superseded.

## Typography and color

Official Inter variable is self-hosted through next/font/local at weights 100–900, with SIL OFL in apps/web/src/app/fonts/OFL-Inter.txt. Body and controls use 400; headings use 500. The stack is --font-sans, Inter, system-ui, sans-serif. IBM Plex Mono remains self-hosted at 400/500 for code and credentials. No remote font dependency is needed.

Console body is 14px/1.45; page headings are 28px/1.2 with -0.025em tracking, sections 21px, subheadings 16px and controls generally 13px. Mobile page headings become 24px and sections 19px. Dialog fields use 16px on mobile. Paragraphs use 1.55 line-height. The frontmatter records the principal current roles; inherited components may retain more specific source values.

Use #fafafa ground, #262626 ink, #525252 secondary text, opaque #f4f4f4 content and #e5e5e5 fields. Checklist and workspace rows retain #f1f1f1. Blue #2878c9 marks primary actions, focus and caret; #1d67b1 is the accent-hover token. Neutral surfaces and understated separators provide structure. Category selection uses a dark underline and dark text on the same neutral background.

## Layout and materials

The desktop workspace has a 72px horizontal header and a centered floating five-destination dock. Content views reach 1120px; minimal task pages reach 1080px. At 760px, desktop links hide, the header is 62px, content has 20px side padding and 112px bottom clearance, and the dock fits within a 420px maximum and safe-area-aware bottom placement. The dock is also present on desktop. Preserve keyboard focus, aria-current, native form semantics, loading/error/empty states and reduced motion.

Overview uses two equal desktop columns with a 30px gap: setup checklist on the left, workspace row and clear liquid-glass card on the right. It stacks at 760px. Checklist rows are at least 84px on desktop and 66px on mobile. Agent rows follow beneath. The clear liquid-glass LiquidWalletCard replaces the charcoal/silver card in Overview and Wallet. Its semantic content uses the actual ABI ABMark, workspace name, USDC and network; decorative material and watermark are hidden from accessibility APIs. The full Overview card is a button opening Wallet. It has no card number or card-network branding.

Wallet uses a 1fr / 1.06fr summary grid with a 34px gap: card left, real balance rows and Receive/Allocate/Move actions right. Allocations and actual activity follow below. At 760px it stacks with a 30px gap; the three balance metrics share one opaque gray strip. Allocation/activity rows wrap, preserving usable controls and readable amounts.

Content, provider rows, seller forms and spending controls are opaque. Glass is reserved for navigation, account menus and the vault card. Header glass uses #fafafad9 with 24px blur; the dock uses #fafafaa6 with 28px blur, white inset highlights and a subtle shadow. Account menus use #fafafae6 and 28px blur. Reduced-transparency preferences make the designated navigation surfaces opaque. Dialogs use opaque #fafafa, bounded viewport height, internal scrolling and an overlay; they are not glass content cards.

## Liquid-glass wallet component

The wallet uses transparent CSS optical-glass layers rather than the former metallic-looking image material. A clear white wash, 20px backdrop blur with 125% saturation, thin inset highlights and soft diagonal reflections define the surface. The card uses the standard ID-1 bank-card ratio, 85.60 / 53.98 (approximately 1.586), with a 460px maximum width and 22px corners; text remains semantic above the material. Use the wallet tokens in frontmatter. Desktop padding is 27px 30px; mobile uses 22px 23px. Layered, softly offset shadows ground the glass without a thick chrome rim. Brand text uses 17px/500 and 0.16em tracking, stepping to 15px/0.12em on mobile. The actual ABI watermark has final opacity 0.07. The original image asset is retained as historical material and is no longer rendered by the component.

Mouse movement updates only a subtle radial highlight. Hover-capable devices with no reduced-motion preference lift an interactive card by 2px and adjust its shadow, using 220ms ease-out. Reduced motion disables transitions and pointer tracking; touch has no pointer-follow effect. Keyboard focus uses a visible 3px blue outline with 7px offset. Working rows and confirmation/action dialogs stay opaque.

## Navigation and workspaces

Buyer navigation is Overview, Marketplace, Connect, Billing and Settings. Seller navigation is Overview, Inventory, Connect, Payouts and Settings. Wallet replaces Treasury’s presentation and is reached through the full Overview card or Wallet details; its internal treasury identifier remains compatible. The buyer header removes Sell on ABI, while the account menu retains seller entry. There is no More menu or standalone ledger/webhook destination. Existing financial, settlement, audit and Cash/analytics code remains internally available, without a standalone wallet analytics tab. The interface is pinned light; the nonfunctional Theme menu has been removed.

Marketplace provides provider/product segmentation, search, category tabs and understated provider/result rows from published inventory. Tools & APIs, Software and Physical goods have equal prominence. There is no Demo/Live selector; the Purchases tab owns order content. Catalog result images are 52px squares in the current console, and provider rows use opaque #f4f4f4 with 12px corners. Never substitute invented vendors or study balances for actual data.

Connect centers setup and scoped-key administration. Creation opens a dialog; secrets have one-time delivery, replacement and revocation retain existing controls, and secrets must not persist in localStorage. New keys omit x402BudgetUsdc and inherit the agent’s existing allowance, spending limits and approval controls. Read access is the default; pay requires explicit selection. Existing key-specific caps remain displayed and enforced. Fields use neutral fills, 7px corners and visible blue focus. Principal console buttons use 6px corners and a 36px minimum height; dialog actions use at least 38px. Disabled controls remain visibly unavailable.

Billing separates Overview and Spending limits. Limits use UTC calendar day/week/month windows, a shared workspace cap or a total window expiring within 90 days, per-purchase controls, approval rules and recurring-purchase opt-out. Editing a total window preserves its original start time. Existing daily limits and agent budgets remain in force. Connected-service write actions are explicitly unavailable rather than enabled decorative switches.

Seller overview, inventory, connection, payout and settings surfaces share the same typography and opaque materials. Seller authentication ends a session only on a definitive 401. Network/429/5xx and malformed-response errors retain the session and provide recovery. Buyer/seller identity realms, verification and MFA remain separate and enforced.

Wallet exposes verified Receive, allocation, internal Move and source-backed pending/recent activity. Unknown amounts show explicit unavailable states. Totals use organization availability, department/shared allocations and actual held balances without double-counting agent aliases. A failed or malformed receiving-profile refresh clears prior receiving details. Move opens a review before POST; opening Allocate from a department/shared row preserves that selected destination. Settings → Security and recovery hosts custody recovery with a confirmation for each operation. Preserve existing approval, read-only and server-policy checks.

## Financial truth and evidence

USD card credits and Base Sepolia USDC settlement remain distinct. Card funding, saved-card and auto-top-up actions stay gated until operator configuration and usage/refund policy are ready. Checkout redirects do not establish credits; no USD consumption or fiat-to-USDC conversion is implemented. The interface and study do not prove live funding, purchases, shipping or fulfillment.

This document records current source and approved direction. It does not certify rendering or deployment. The fresh liquid-wallet finish verdict is ship following both requested source corrections. A bounded browser confirmation batch refreshed 14 screenshots and report.json; synthetic checks cover malformed successful responses and 503 failures clearing receiving details, plus second-department/shared allocation destinations. The final build passes; lint reports zero errors and eight baseline warnings. This evidence establishes the reviewed interface and bounded fixture behavior, without establishing a production release or live financial operations. Launcher/detector/phase/spec automation is unavailable. Prior revision reviews and synthetic fixtures establish only their bounded evidence.

Sources: apps/web/src/app/reference-console.css (loaded after minimal-workspace.css), app/layout.tsx, lib/studio-nav.tsx, lib/minimal-workspace.tsx, lib/spending-limits.tsx, lib/seller-session.ts lib/liquid-wallet-card.tsx, lib/wallet-workspace.tsx, lib/wallet-summary.ts, lib/wallet-receive-validation.ts, lib/treasury-view.tsx, lib/settings-view.tsx and app/liquid-wallet.css. Inherited layout and state rules remain in minimal-workspace.css, globals.css and console-studio.css.

Liquid-wallet evidence: .impeccable/review/liquid-wallet/report.json and 14 captures (overview, wallet, receive, allocate, move-review, payment-key and recovery-review at 1440px/390px). Artifacts are local and ignored, not committed. Browser script/log: /tmp/abi-wallet-browser.cjs and /tmp/abi-wallet-browser-final.log. Final build: /tmp/abi-wallet-review-build.log. Test logs: /tmp/abi-wallet-payment-tests2.log (20 cases), /tmp/abi-wallet-web-tests.log (156 cases), /tmp/abi-wallet-receive-tests.log (2 new cases). These source/test records do not establish a production release.
