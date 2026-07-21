# PolicyVault / ABI — Full UI Audit

**Date:** 2026-07-21  
**Scope:** `apps/web` — marketing (`/`, `/about`, `/pricing`, `/docs`) + Guardian Console (`/console`)  
**Method:** Code review + headless browser smoke test + lenses from the design skill references you provided  
**Preview (live):** `http://localhost:3000` (marketing) · `http://localhost:3000/console` (app)

---

## Executive summary

| Dimension | Score | Grade |
|-----------|-------|-------|
| **Brand & visual identity** | 8.0/10 | A− |
| **Dashboard / data density** | 7.5/10 | B+ |
| **Component system (shadcn lens)** | 4.5/10 | D+ |
| **Accessibility** | 5.5/10 | C |
| **Mobile / responsive** | 4.0/10 | D |
| **Motion & polish (GSAP lens)** | 6.5/10 | B− |
| **Minimalist discipline** | 7.0/10 | B |
| **Premium / fintech feel** | 7.5/10 | B+ |
| **Maintainability** | 5.0/10 | C |
| **Overall UI product readiness** | **6.8/10** | **B−** |

**One-line verdict:** The UI has a **strong, distinctive fintech-terminal identity** (dark cards on cool gray, Sora + JetBrains Mono, AB vault mark). It is **not generic shadcn/Tailwind** — that is a deliberate choice. The biggest gaps vs premium dashboard standards are **mobile console**, **a11y primitives**, **token bugs**, and **god-file maintainability** — not “make it prettier.”

---

## How to preview in Claude Code / Cursor

```bash
# Terminal 1 — API
cd /workspace
POLICYVAULT_ALLOW_BOOTSTRAP=1 ABI_KEY_PEPPER=dev-pepper PORT=8787 npm run dev -w @policyvault/api

# Terminal 2 — Web
cd /workspace
npm run dev -w @policyvault/web
```

| URL | What you see |
|-----|----------------|
| http://localhost:3000 | Landing |
| http://localhost:3000/console | Login → **Launch demo org** |
| http://localhost:3000/pricing | Pricing |
| http://localhost:3000/docs | Docs |

**Desktop via cloud agent:** Forward **both** ports **3000** and **8787** (Console calls `localhost:8787` directly).

**Smoke test result (2026-07-21):** Login → bootstrap → Overview loads with org treasury, agents, nav — **no JS errors**, all guardian API calls **200**.

---

## Architecture snapshot

```
apps/web/src/
├── app/
│   ├── globals.css      ← ~3,400 lines — entire design system
│   ├── layout.tsx       ← Sora + JetBrains Mono
│   ├── page.tsx         ← Landing
│   └── console/page.tsx ← 2,545 lines — shell + 8 inline views
└── lib/
    ├── ui.tsx           ← Icon, charts, Stat, Empty, formatters
    ├── brand.tsx        ← AB mark / lockup SVGs
    ├── marketing-shell.tsx
    ├── treasury-view.tsx, agents-view.tsx, payments-view.tsx, …
    └── page-tour.tsx
```

**Stack:** Next.js 15 + React 19. **No** Tailwind, **no** shadcn, **no** Radix, **no** Framer/GSAP.

---

## Lens 1 — Anthropic Frontend Design skill

> *Distinctive, intentional, subject-grounded; typography carries personality; one signature element; restraint.*

| Criterion | Assessment |
|-----------|------------|
| **Distinctive vs template?** | **Yes.** Light canvas + near-black console cards is ownable for “financial OS for agents.” Not cream-serif-terracotta or acid-green-on-black defaults. |
| **Typography** | **Strong.** Sora (UI) + JetBrains Mono (money/code) — deliberate fintech pairing. |
| **Signature element** | **AB hex vault mark** + orbiting hero graphic on landing — memorable. |
| **Motion restraint** | **Mixed.** Landing hero orbits are tasteful; console re-animates `fade-up` on every tab switch (`key={view}`) — feels busy on repeat navigation. |
| **Copy in UI** | **Good.** “Launch demo org”, “Freeze desk”, policy band labels — plain verbs, not jargon-first. |
| **Risk taken** | Dark-in-light console on gray marketing page — justified for “terminal” metaphor. |

**Score: 8/10** — Would improve by reducing tab-switch animation and tightening one hero metaphor (bell icon used for both Chat nav and notifications).

---

## Lens 2 — shadcn / Radix component patterns

> *Accessible primitives: Dialog, Select, Tabs, Toast, focus trap, aria-*.*

| Pattern | Current | shadcn expectation |
|---------|---------|-------------------|
| Buttons | Global `button` + modifiers | `Button` variants + focus ring consistency |
| Tabs / segments | `.seg` buttons, no `aria-pressed` | `Tabs` with keyboard roving |
| Dialogs / panels | Notification panel, no focus trap | `Dialog` + Escape |
| Select | Native `<select>` + custom chips | `Select` / `Combobox` |
| Toast | Custom `.toast` | `Sonner` / `Toast` + `role="status"` everywhere |
| Forms | `.field` + native inputs | `Label` + `Form` + error states |
| Tables | `.tbl-wrap` scroll | `DataTable` + sticky header patterns |

**Score: 4.5/10** — Not “missing shadcn” accidentally; rebuilding Select/Dialog/Tabs by hand without Radix shows in a11y gaps.

**Recommendation:** Do **not** full-migrate to shadcn overnight. **Cherry-pick** Radix primitives for: notification panel, modals, combobox (agent picker), toast — keep existing CSS tokens.

---

## Lens 3 — Dashboard patterns (awesome-dashboard lens)

> *KPI hierarchy, scannable tables, command center, sidebar nav, density control.*

| Pattern | Status | Notes |
|---------|--------|-------|
| KPI strip | ✅ | Overview: vault, agents, spent, blocked |
| Sidebar nav | ✅ | Icon rail — good for desktop |
| Command palette | ❌ | No ⌘K jump |
| Table density | ⚠️ | Tables work; no column toggle / compact mode |
| Global search | ⚠️ | Topbar search UI present; limited scope |
| Drill-down | ✅ | Agents → detail pane; Treasury tabs |
| Status at a glance | ✅ | Pills (ok/warn/bad), banners |
| Real-time feel | ✅ | 4s/15s polling — can feel heavy |

**Score: 7.5/10** — Solid operator dashboard; missing power-user affordances (palette, density, saved views).

---

## Lens 4 — UI/UX Pro Max / Premium frontend

| Heuristic | Pass? | Issue |
|-----------|-------|-------|
| Visual hierarchy | ✅ | Card heads, subs, mono for numbers |
| Consistent spacing | ⚠️ | Mix of inline `style={{}}` + classes |
| Loading states | ⚠️ | Skeleton on shell; not all views |
| Empty states | ✅ | `Empty` component used well |
| Error states | ⚠️ | Toasts; some `prompt()` remnants removed in agents fund |
| Trust / credibility | ✅ | Legal footers, policy bands, audit export |
| Onboarding | ✅ | PageTour per view |
| **Broken tokens** | ❌ | `--warn` used but **undefined** (`console/page.tsx:1242`, `views.tsx:498`) — should be `--orange` |

**Score: 7.5/10** — Premium feel until token bugs and mobile break immersion.

---

## Lens 5 — GSAP / motion skill

| Motion | Implementation | Verdict |
|--------|----------------|---------|
| Page enter | CSS `fade-up` | OK |
| Hero orbits | CSS keyframes | Good; respects `prefers-reduced-motion` |
| Bar charts | `grow-bar` animation | Smart remount key in `ui.tsx` |
| Console tab switch | `fade-up` every time | **Reduce** — use opacity only or skip on revisit |
| Micro-interactions | Button hover lift on marketing | Subtle, good |
| Scroll-driven | None | Fine for dashboard; landing could use one scroll reveal |

**Score: 6.5/10** — CSS-only is fine; extend `prefers-reduced-motion` to **all** console animations, not just hero.

---

## Lens 6 — Minimalist UI

| Principle | Assessment |
|-----------|------------|
| One job per element | Mostly yes; Overview is dense but purposeful |
| Decoration | Low — grid wash on body is subtle |
| Color count | Controlled token set |
| Typography scale | Clear h1/h2/card-head |
| **Cognitive load** | Console Overview packs many widgets — borderline for “minimalist” |

**Score: 7/10** — Marketing is minimal; console Overview is **information-rich** (appropriate for ops, not minimal).

---

## Lens 7 — Industrial / brutalist UI

| Trait | Present? |
|-------|----------|
| Raw monospace data | ✅ Balances, addresses, endpoints |
| High contrast | ✅ Black cards, white text |
| Exposed structure | ✅ Ledger, audit export, policy rule IDs |
| Unstyled utilitarian | ❌ Too polished — glass inset, soft radii, blue accent |
| Harsh grid / rules | ⚠️ Subtle body grid only |

**Score: 6/10** — “Institutional terminal” more than brutalist. Fits ABI positioning.

---

## Lens 8 — Mobile app / Material 3 / SwiftUI (cross-platform lens)

Not a mobile app today — but if you ship native later:

| Web gap | Native implication |
|---------|-------------------|
| Fixed 76px rail | → Bottom tab bar (Material nav bar / SwiftUI TabView) |
| Hover tooltips on rail | → Labels always visible |
| Wide tables | → Card lists per row |
| No bottom sheet | → Approvals as sheet |
| Touch targets | Some `.sm` buttons < 44px |

**Score: 4/10 mobile readiness** — Desktop-first console; marketing nav **hides links at 900px with no hamburger**.

---

## Page-by-page audit

### Landing `/` — **8/10**
- Hero orbit + vault graphic = strong signature
- Trust strip, feature grid, enterprise block — complete story
- CTA to `/console` clear
- **Fix:** mobile nav dead zone @900px

### Console login — **7.5/10**
- Clear value props + demo bootstrap
- **Fix:** add connection hint when API down; stale key messaging

### Overview — **7.5/10**
- Best “command center” view — KPIs, calendar, agents, move funds
- Dense but scannable
- **Fix:** `--warn` token; reduce animation on revisit

### Treasury — **8/10** (post depth-10)
- Fund-first, shared wallet members, recovery — strong
- **Fix:** demo vs live badge for deposit

### Agents — **7.5/10**
- Groups actionable; first-paint optimized
- **Fix:** roster table needs `.tbl-wrap`; session reveal card light fallback color

### Payments — **7.5/10**
- Good tab hub; batch composer added
- **Fix:** discoverability — invoices/escrows only under Payments

### Policy — **8.5/10**
- Best-in-product — visual bands, limits, automation, quorum
- Reference implementation for other views

### Playground — **8/10**
- Missions + run modes — high engagement
- **Fix:** seller URL hardcoded `localhost:9402` — breaks remote preview

### Settings — **7/10**
- Honest go-live checklist
- Long scroll; could use anchor nav

### Marketing secondary (`/about`, `/pricing`, `/docs`) — **7.5/10**
- Consistent shell; pricing tier highlight works
- Docs code block is on-brand

---

## Critical bugs (fix before next design pass)

| # | Issue | File | Fix |
|---|-------|------|-----|
| 1 | `--warn` undefined | `console/page.tsx:1242`, `views.tsx:498` | Use `--orange` or add `--warn: var(--orange)` |
| 2 | Missing favicons | `layout.tsx` references PNGs | Add `favicon-16.png`, `icon-192.png`, etc. or fix links |
| 3 | Mobile marketing nav | `globals.css:2456` | Hamburger or always-visible CTA row |
| 4 | Mobile console | `globals.css:536` | Bottom nav or collapsible rail @820px |
| 5 | `user-chip` not keyboard accessible | `console/page.tsx` | `button` + `aria-expanded` |
| 6 | Playground seller URL | `console/page.tsx` `SELLER` | Env-driven + proxy option |

---

## Prioritized improvement roadmap

### P0 — polish without redesign (1–2 days)
1. Fix `--warn` + `--border-strong` tokens in `globals.css`
2. Add missing `public/` favicons
3. Mobile marketing hamburger menu
4. `prefers-reduced-motion` for all console animations
5. `aria-label` on search; `aria-current` on active rail item

### P1 — dashboard premium (3–5 days)
6. Extract `console/page.tsx` views → `overview-view.tsx`, `login-view.tsx`, etc.
7. Command palette (⌘K) — jump view / agent / approve
8. Skeleton loaders on Agents + Treasury first paint
9. Radix Dialog for notification panel + key reveal modals
10. Compact table density toggle

### P2 — design system evolution (1–2 weeks)
11. Token package: export CSS vars → TS for charts
12. Optional shadcn-on-tokens: Button, Tabs, Toast, Select only
13. Mobile console: bottom tab bar pattern
14. GSAP or Motion One **only** for landing hero (one orchestrated sequence)
15. Dark/light toggle (marketing only) — optional

---

## What NOT to do (per Frontend Design skill)

- Do **not** swap to generic cream-serif + terracotta landing
- Do **not** add animation everywhere — console is ops software
- Do **not** full shadcn migration — you’d lose the custom terminal identity
- Do **not** chase industrial brutalist unless repositioning brand

---

## Reference skill mapping

| Your link | How we applied it |
|-----------|-------------------|
| Anthropic Frontend Design | Identity, typography, signature, restraint |
| shadcn UI skill | Component/a11y gap analysis |
| awesome-dashboard | KPI, nav, tables, density |
| UI UX Pro Max | Heuristic pass + token bugs |
| GSAP skill | Motion inventory + reduced-motion |
| Minimalist UI | Density vs simplicity tradeoff |
| Industrial brutalist | Terminal vs brutalist fit |
| Premium frontend | Fintech polish bar |
| Mobile / SwiftUI / M3 / Expo | Mobile gap analysis for future native |

---

## Files to read first (design audit trail)

| File | Why |
|------|-----|
| `apps/web/src/app/globals.css` | All tokens + breakpoints |
| `apps/web/src/app/console/page.tsx` | Shell, polling, inline views |
| `apps/web/src/lib/policy-view.tsx` | Best UX reference |
| `apps/web/src/lib/ui.tsx` | Shared primitives |
| `apps/web/src/lib/brand.tsx` | Logo system |
| `apps/web/src/app/page.tsx` | Marketing hero |

---

**Bottom line for preview:** Open `http://localhost:3000/console` → **Launch demo org** — the product **works and looks cohesive**. The audit says where it stops being “demo-good” and starts needing **mobile + a11y + token hygiene** to feel **production-premium**.
