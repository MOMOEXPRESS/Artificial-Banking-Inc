# PolicyVault / ABI — Document Index

Master index of planning and build documents for **PolicyVault** (product), **Artificial Banking Inc** (optional OpCo), and the **AI Agent Economic OS** thesis.

All paths below are absolute. Prefer the **Canonical for building** set when implementing.

---

## Canonical for building

Use these three first when coding or reviewing scope:

| Document | Path | Description |
|----------|------|-------------|
| **Platform Architecture** | [`docs/PLATFORM-ARCHITECTURE.md`](./PLATFORM-ARCHITECTURE.md) | Live extension-point map for the 13 platform pillars — **read before adding features.** |
| **Audit Findings** | [`docs/AUDIT-FINDINGS.md`](./AUDIT-FINDINGS.md) | Verified security findings: fixed / open / deferred with reasoning. |
| **Console UX Audit** | [`docs/CONSOLE-UX-AUDIT.md`](./CONSOLE-UX-AUDIT.md) | UI/UX + stress probe + interactability ranking (Jul 2026). |
| **Full System Review** | [`docs/FULL-SYSTEM-REVIEW.md`](./FULL-SYSTEM-REVIEW.md) | End-to-end action catalog, scores, pillar depth, live probe results. |
| **Pillar Depth Audit** | [`docs/PILLAR-DEPTH-AUDIT.md`](./PILLAR-DEPTH-AUDIT.md) | Every sub-capability DONE/PARTIAL/STUB/DEFERRED + brainstorm beyond the 13 pillars. |
| **Validation Build Rundown** | [`docs/VALIDATION-BUILD-RUNDOWN.md`](./VALIDATION-BUILD-RUNDOWN.md) | Sign-off-ready MVP rundown: architecture, features, UI, agent surfaces, phases, validation checklist. |
| **Full-Scale Build Plan** | [`docs/FULL-SCALE-BUILD-PLAN.md`](./FULL-SCALE-BUILD-PLAN.md) | Master engineering/product plan: bounded contexts, data model, money flows, SDK/MCP, roadmap, NFRs, DoD. |
| **README** | [`README.md`](../README.md) | Repo overview, monorepo map, quick start, phase map. |

---

## Strategy & product canvases (Cursor)

Interactive Cursor canvases (open beside chat). Markdown exports for reading outside Cursor are under `docs\plans\`.

| Document | Canvas (interactive) | Markdown export | Description |
|----------|----------------------|-----------------|-------------|
| **AI Agent Economic OS plan** | [C:\Users\ebale\Projects\policyvault\docs\canvases\ai-agent-economic-os-plan.canvas.tsx](C:\Users\ebale\Projects\policyvault\docs\canvases\ai-agent-economic-os-plan.canvas.tsx) | [C:\Users\ebale\Projects\policyvault\docs\plans\ai-agent-economic-os-plan.md](C:\Users\ebale\Projects\policyvault\docs\plans\ai-agent-economic-os-plan.md) | Full product thesis: Economic OS positioning, landscape, personas, loops, architecture, safety, MVP, roadmap. |
| **Artificial Banking Inc plan** | [C:\Users\ebale\Projects\policyvault\docs\canvases\artificial-banking-inc-plan.canvas.tsx](C:\Users\ebale\Projects\policyvault\docs\canvases\artificial-banking-inc-plan.canvas.tsx) | [C:\Users\ebale\Projects\policyvault\docs\plans\artificial-banking-inc-plan.md](C:\Users\ebale\Projects\policyvault\docs\plans\artificial-banking-inc-plan.md) | Stress-test of ABI packaging: what works vs wishful, token sequencing, entity architecture, fundraising. |
| **ABI GTM & fundraising** | [C:\Users\ebale\Projects\policyvault\docs\canvases\abi-gtm-fundraising.canvas.tsx](C:\Users\ebale\Projects\policyvault\docs\canvases\abi-gtm-fundraising.canvas.tsx) | [C:\Users\ebale\Projects\policyvault\docs\plans\abi-gtm-fundraising.md](C:\Users\ebale\Projects\policyvault\docs\plans\abi-gtm-fundraising.md) | Positioning, capital paths, token launch rules, marketing channels, 90-day calendar, red flags. |
| **ABI stress-test briefing** | [C:\Users\ebale\Projects\policyvault\docs\canvases\abi-stress-test-briefing.canvas.tsx](C:\Users\ebale\Projects\policyvault\docs\canvases\abi-stress-test-briefing.canvas.tsx) | [C:\Users\ebale\Projects\policyvault\docs\plans\abi-stress-test-briefing.md](C:\Users\ebale\Projects\policyvault\docs\plans\abi-stress-test-briefing.md) | Blunt short briefing: viable-if-pivoted verdict, competitor kill-map, death scenarios, reframes. |

---

## Original sources (Cursor project copies)

These are the originals that were copied into this repo. Prefer the `policyvault\docs\` copies above as the project-local canonical set.

| Original | Path |
|----------|------|
| Validation rundown (source) | [C:\Users\ebale\.cursor\projects\empty-window\POLICYVAULT-VALIDATION-BUILD-RUNDOWN.md](C:\Users\ebale\.cursor\projects\empty-window\POLICYVAULT-VALIDATION-BUILD-RUNDOWN.md) |
| Full-scale build plan (source) | [C:\Users\ebale\.cursor\projects\empty-window\ABI-FULL-SCALE-BUILD-PLAN.md](C:\Users\ebale\.cursor\projects\empty-window\ABI-FULL-SCALE-BUILD-PLAN.md) |
| Economic OS canvas (source) | [C:\Users\ebale\.cursor\projects\empty-window\canvases\ai-agent-economic-os-plan.canvas.tsx](C:\Users\ebale\.cursor\projects\empty-window\canvases\ai-agent-economic-os-plan.canvas.tsx) |
| ABI plan canvas (source) | [C:\Users\ebale\.cursor\projects\empty-window\canvases\artificial-banking-inc-plan.canvas.tsx](C:\Users\ebale\.cursor\projects\empty-window\canvases\artificial-banking-inc-plan.canvas.tsx) |
| GTM canvas (source) | [C:\Users\ebale\.cursor\projects\empty-window\canvases\abi-gtm-fundraising.canvas.tsx](C:\Users\ebale\.cursor\projects\empty-window\canvases\abi-gtm-fundraising.canvas.tsx) |
| Stress-test canvas (source) | [C:\Users\ebale\.cursor\projects\empty-window\canvases\abi-stress-test-briefing.canvas.tsx](C:\Users\ebale\.cursor\projects\empty-window\canvases\abi-stress-test-briefing.canvas.tsx) |

---

## Folder layout

```
C:\Users\ebale\Projects\policyvault\
  README.md                          ← repo entry + link to this index
  docs\
    INDEX.md                         ← this file
    VALIDATION-BUILD-RUNDOWN.md      ← canonical MVP / validation
    FULL-SCALE-BUILD-PLAN.md         ← canonical full build plan
    canvases\                        ← .canvas.tsx copies (Cursor interactive)
    plans\                           ← markdown exports of canvases
```

---

## How to use

1. **Building / implementing:** start with `VALIDATION-BUILD-RUNDOWN.md`, then `FULL-SCALE-BUILD-PLAN.md`, then `README.md`.
2. **Strategy / positioning / token / GTM:** read the canvases (or `docs\plans\` markdown exports).
3. **Cursor UI:** open `.canvas.tsx` files from `docs\canvases\` (or the empty-window originals) as live canvases when the IDE supports them.
