#!/usr/bin/env node
/**
 * `npm run env:secrets` — mint the three secrets a hosted deployment needs.
 *
 * Prints them once, in paste-ready `KEY=value` form, split by where each one
 * goes. Nothing is written to disk: these belong in the host's secret store
 * (Render → Environment, Vercel → Settings → Environment Variables), not in a
 * file that can end up in a commit.
 *
 * ABI_KEK deserves special care. Every vault private key is encrypted under it,
 * so losing it means losing access to every vault. Back it up before the first
 * deploy, somewhere that outlives the hosting account.
 */
import { randomBytes } from "node:crypto";

const secret = () => randomBytes(32).toString("base64");

const kek = secret();
const pepper = secret();
const signup = secret();

const out = `
# --- API service (Render / Railway / Fly / VPS) ---------------------------
# Back ABI_KEK up before deploying. Lose it and every vault key is gone.
ABI_KEK=${kek}
ABI_KEY_PEPPER=${pepper}
ABI_SIGNUP_TOKEN=${signup}

# --- Console (Vercel) — server-side only, never NEXT_PUBLIC_ ------------
# Must be the SAME value as on the API: the /abi-api proxy attaches it to
# "Create account", "Create organization" and demo seeding.
ABI_SIGNUP_TOKEN=${signup}

# Not secrets, but set them at the same time — see docs/DEPLOY.md:
#   API:     ABI_CONSOLE_URL, ABI_CORS_ORIGINS  (your Vercel URL)
#   Console: ABI_API_ORIGIN                      (your API URL, no trailing slash)
`.trimStart();

process.stdout.write(out);
