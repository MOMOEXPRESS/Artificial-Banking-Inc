#!/usr/bin/env node
/**
 * Once-and-for-all Vercel access harden for Artificial Banking Inc.
 *
 * Fixes the two dashboard issues that surface as “404 NOT_FOUND” / a Vercel
 * login wall instead of the Next app:
 *   1. Deployment Protection (SSO) on Production → disable it
 *   2. Print the only canonical *.vercel.app URL for this team project
 *
 * Short names like artificial-banking-inc.vercel.app are NOT assigned to team
 * projects (slug is project-team) and will keep returning platform 404 — do
 * not use them. Add a custom domain in the dashboard if you want a short URL.
 *
 * Usage:
 *   VERCEL_TOKEN=… npm run vercel:harden
 *
 * Optional env:
 *   VERCEL_TEAM_SLUG=gaia10
 *   VERCEL_PROJECT=artificial-banking-inc
 */

const TOKEN = process.env.VERCEL_TOKEN;
const TEAM_SLUG = process.env.VERCEL_TEAM_SLUG ?? "gaia10";
const PROJECT = process.env.VERCEL_PROJECT ?? "artificial-banking-inc";
const API = "https://api.vercel.com";

if (!TOKEN) {
  console.error(`
Missing VERCEL_TOKEN.

Create one: https://vercel.com/account/tokens
Then:
  VERCEL_TOKEN=… npm run vercel:harden

Without the token this script cannot disable Deployment Protection — that is
the usual reason the real production URL looks “broken” (SSO login) while
artificial-banking-inc.vercel.app returns x-vercel-error: NOT_FOUND.
`);
  process.exit(1);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

function canonicalUrl(project, teamSlug) {
  // Team projects: {project}-{team}.vercel.app
  return `https://${project}-${teamSlug}.vercel.app`;
}

async function main() {
  console.log(`Resolving team “${TEAM_SLUG}” / project “${PROJECT}”…`);

  const teams = await api("/v2/teams");
  const team = (teams.teams ?? []).find((t) => t.slug === TEAM_SLUG);
  if (!team) {
    console.error(
      `Team slug “${TEAM_SLUG}” not found for this token. Teams: ${(teams.teams ?? [])
        .map((t) => t.slug)
        .join(", ") || "(none)"}`,
    );
    process.exit(1);
  }
  const teamId = team.id;
  const q = `teamId=${encodeURIComponent(teamId)}`;

  const project = await api(`/v9/projects/${encodeURIComponent(PROJECT)}?${q}`);
  console.log(`Project id: ${project.id}`);
  console.log(`Framework:  ${project.framework ?? "(unset)"}`);
  console.log(`Root dir:   ${project.rootDirectory ?? "(repo root)"}`);

  const before = project.ssoProtection ?? null;
  console.log(`SSO protection before: ${JSON.stringify(before)}`);

  if (before) {
    console.log("Disabling Vercel Authentication (ssoProtection → null)…");
    await api(`/v9/projects/${encodeURIComponent(project.id)}?${q}`, {
      method: "PATCH",
      body: { ssoProtection: null },
    });
    const after = await api(`/v9/projects/${encodeURIComponent(project.id)}?${q}`);
    console.log(`SSO protection after:  ${JSON.stringify(after.ssoProtection ?? null)}`);
  } else {
    console.log("SSO protection already off — nothing to change.");
  }

  const domains = await api(`/v9/projects/${encodeURIComponent(project.id)}/domains?${q}`);
  const names = (domains.domains ?? []).map((d) => d.name);
  console.log("Assigned domains:");
  for (const n of names) console.log(`  - https://${n}`);

  const want = [
    `${PROJECT}.vercel.app`,
    `${PROJECT.replace(/-/g, "")}.vercel.app`,
  ];
  for (const name of want) {
    if (names.includes(name)) continue;
    console.log(`\nTrying to claim ${name} (may be unavailable for team projects)…`);
    try {
      await api(`/v9/projects/${encodeURIComponent(project.id)}/domains?${q}`, {
        method: "POST",
        body: { name },
      });
      console.log(`  ✓ added ${name}`);
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message.split("\n")[0]}`);
    }
  }

  const url = canonicalUrl(PROJECT, TEAM_SLUG);
  console.log(`
────────────────────────────────────────────────────────
Canonical production URL (use this, bookmark this):

  ${url}

Wrong (platform 404 — not assigned to team gaia10):
  https://${PROJECT}.vercel.app
  https://artificialbankinginc.vercel.app

If the canonical URL still asks for Vercel login, re-check
Project → Settings → Deployment Protection in the dashboard.
────────────────────────────────────────────────────────
`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
