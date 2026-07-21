#!/usr/bin/env node
/**
 * Once-and-for-all Vercel access harden for Artificial Banking Inc.
 *
 * Fixes dashboard issues that surface as “404 NOT_FOUND” / a Vercel login wall
 * / ignored Project Settings:
 *   1. rootDirectory → apps/web (so dashboard Build settings apply; no legacy
 *      root vercel.json `builds` key)
 *   2. sourceFilesOutsideRootDirectory → true (npm workspaces / packages/*)
 *   3. Deployment Protection (SSO) on Production → disable it
 *   4. Print the only canonical *.vercel.app URL for this team project
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
const ROOT_DIRECTORY = "apps/web";
const API = "https://api.vercel.com";

if (!TOKEN) {
  console.error(`
Missing VERCEL_TOKEN.

Create one: https://vercel.com/account/tokens
Then:
  VERCEL_TOKEN=… npm run vercel:harden

Without the token this script cannot set Root Directory / disable Deployment
Protection — those are the usual reasons builds ignore Project Settings or the
real production URL looks “broken” (SSO login).
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

  let project = await api(`/v9/projects/${encodeURIComponent(PROJECT)}?${q}`);
  console.log(`Project id: ${project.id}`);
  console.log(`Framework:  ${project.framework ?? "(unset)"}`);
  console.log(`Root dir:   ${project.rootDirectory ?? "(repo root)"}`);
  console.log(
    `Outside root files: ${project.sourceFilesOutsideRootDirectory ?? "(default)"}`,
  );

  const patch = {};
  if (project.rootDirectory !== ROOT_DIRECTORY) {
    patch.rootDirectory = ROOT_DIRECTORY;
  }
  if (project.sourceFilesOutsideRootDirectory !== true) {
    patch.sourceFilesOutsideRootDirectory = true;
  }
  const beforeSso = project.ssoProtection ?? null;
  console.log(`SSO protection before: ${JSON.stringify(beforeSso)}`);
  if (beforeSso) {
    patch.ssoProtection = null;
  }

  if (Object.keys(patch).length) {
    console.log(`Patching project: ${JSON.stringify(patch)}`);
    await api(`/v9/projects/${encodeURIComponent(project.id)}?${q}`, {
      method: "PATCH",
      body: patch,
    });
    project = await api(`/v9/projects/${encodeURIComponent(project.id)}?${q}`);
    console.log(`Root dir after:  ${project.rootDirectory ?? "(repo root)"}`);
    console.log(
      `Outside root after: ${project.sourceFilesOutsideRootDirectory ?? "(default)"}`,
    );
    console.log(`SSO protection after:  ${JSON.stringify(project.ssoProtection ?? null)}`);
  } else {
    console.log("Root directory, monorepo sources, and SSO already correct.");
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

Project Settings now apply (no legacy root vercel.json "builds").
Root Directory must stay: ${ROOT_DIRECTORY}
Config file used: apps/web/vercel.json

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
